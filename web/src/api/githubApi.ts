import type { Version, FirmwareFile, FirmwareMetadata } from '../types';
import { 
  getDeviceInfo, 
  resolveChipset, 
  FIRMWARE_JSON_URL, 
  REPOSITORY_TREE_URL, 
  g_txModuleExternalDeviceTypeDict,
  g_receiverDeviceTypeDict,
  g_txModuleInternalDeviceTypeDict
} from './metadata';

const REPO_OWNER = 'olliw42';
const REPO_NAME = 'mLRS';

// cache for API responses with TTL support
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
interface CacheEntry<T> {
  data: T;
  timestamp: number;
}
const cache: Record<string, CacheEntry<unknown>> = {};

function getCached<T>(key: string): T | null {
  const entry = cache[key];
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    delete cache[key];
    return null;
  }
  return entry.data as T;
}

function setCache<T>(key: string, data: T): void {
  cache[key] = { data, timestamp: Date.now() };
}

export function clearCache(): void {
  for (const key in cache) {
    delete cache[key];
  }
}

interface GitHubTreeItem {
  path: string;
  type: string;
  size?: number;
  url?: string;
  sha?: string;
}

interface GitHubTreeResponse {
  tree: GitHubTreeItem[];
  truncated: boolean;
}

export const githubApi = {
  listVersions: async (): Promise<Version[]> => {
    const cached = getCached<Version[]>('versions');
    if (cached) return cached;

    try {
      const response = await fetch(FIRMWARE_JSON_URL);
      if (!response.ok) throw new Error('Failed to fetch versions');
      const data = await response.json();
      
      const versions: Version[] = [];
      
      // 1. Add Official/Pre-releases from JSON
      for (const key in data) {
        const item = data[key];
        let versionStr = key;
        if (item.type === 'release') versionStr += ' (release)';
        else if (item.type === 'pre-release') versionStr += ' (pre-release)';
        else versionStr += ' (dev)';

        versions.push({
          version: key,
          versionStr: versionStr,
          commit: item.commit,
          gitUrl: item.url
        });
      }

      // 2. Discover dev version from main branch tree
      try {
        const treeResp = await fetch(`${REPOSITORY_TREE_URL}main?recursive=true`);
        const treeData: GitHubTreeResponse = await treeResp.json();
        const tree = treeData.tree || [];
        
        // Find a firmware file to extract the version string from (e.g. v1.3.07-@21c6abd9)
        const sampleFile = tree.find((f) => f.path.includes('pre-release-stm32/') && f.path.endsWith('.hex'));
        if (sampleFile) {
            const parts = sampleFile.path.split('-');
            const vPart = parts.find((p) => p.startsWith('v') && p.includes('.'));
            const cPart = parts.find((p) => p.startsWith('@'));
            
            if (vPart && cPart) {
                const devVer = `${vPart}-${cPart}`;
                versions.push({
                    version: 'main',
                    versionStr: `${devVer} (dev)`,
                    commit: 'main',
                    gitUrl: `https://github.com/${REPO_OWNER}/${REPO_NAME}/tree/main`
                });
            } else {
                versions.push({ version: 'main', versionStr: 'main (dev)', commit: 'main', gitUrl: '...' });
            }
        }
      } catch (e) {
        versions.push({ version: 'main', versionStr: 'main (dev)', commit: 'main', gitUrl: '...' });
      }

      setCache('versions', versions);
      return versions;
    } catch (e) {
      console.error('GitHub API error:', e);
      return [];
    }
  },

  listDevices: async (type: string): Promise<string[]> => {
    if (type === 'tx') return Object.keys(g_txModuleExternalDeviceTypeDict);
    if (type === 'rx') return Object.keys(g_receiverDeviceTypeDict);
    if (type === 'txint') return Object.keys(g_txModuleInternalDeviceTypeDict);
    return [];
  },

  listWirelessBridgeFirmware: async (options: { version: string, chipset: string }): Promise<FirmwareFile[]> => {
    // Wireless bridge firmware is always pulled from main branch, as it's not versioned with releases
    const cacheKey = `firmware-main`; 
    let tree: GitHubTreeItem[] = [];

    try {
      const cachedTree = getCached<GitHubTreeItem[]>(cacheKey);
      if (cachedTree) {
        tree = cachedTree;
      } else {
        const treeUrl = `${REPOSITORY_TREE_URL}main?recursive=true`;
        const response = await fetch(treeUrl);
        const data: GitHubTreeResponse = await response.json();
        tree = data.tree || [];
        setCache(cacheKey, tree);
      }

      // Files are named mlrs-wireless-bridge-<chipset>.ino.bin (e.g. mlrs-wireless-bridge-esp8266.ino.bin)
      const targetPrefix = `mlrs-wireless-bridge-${options.chipset}`;

      return tree
        .filter((item) => {
          if (item.type !== 'blob') return false;
          if (!item.path.includes('firmware/wirelessbridge/')) return false;
          
          const filename = item.path.split('/').pop() || '';
          return filename.startsWith(targetPrefix);
        })
        .map((item) => {
          const filename = item.path.split('/').pop() || 'firmware.bin';
          const ref = 'main'; // Always use main for wireless bridge
          const rawUrl = `https://cdn.jsdelivr.net/gh/${REPO_OWNER}/${REPO_NAME}@${ref}/${item.path}`;

          return {
            filename,
            path: item.path,
            url: rawUrl,
            size: item.size
          };
        });
    } catch (e) {
      console.error('Failed to list wireles bridge firmware:', e);
      return [];
    }
  },

  listFirmware: async (options: { type: string, device?: string, version: string, luaFolder?: string }): Promise<{ files: FirmwareFile[] }> => {
    const cacheKey = `firmware-${options.version}`;
    let tree: GitHubTreeItem[] = [];

    try {
      const cachedTree = getCached<GitHubTreeItem[]>(cacheKey);
      if (cachedTree) {
        tree = cachedTree;
      } else {
        let treeUrl = '';
        if (options.version === 'main') {
          treeUrl = `${REPOSITORY_TREE_URL}main?recursive=true`;
        } else {
          const versions = await githubApi.listVersions();
          const versionInfo = versions.find(v => v.version === options.version);
          if (!versionInfo || !versionInfo.commit) return { files: [] };
          // We fetch the recursive tree for that commit
          treeUrl = `${REPOSITORY_TREE_URL}${versionInfo.commit}?recursive=true`;
        }

        const response = await fetch(treeUrl);
        const data: GitHubTreeResponse = await response.json();
        tree = data.tree || [];
        setCache(cacheKey, tree);
      }

      const { deviceDict } = getDeviceInfo(options.device || '', options.type);
      const fname = deviceDict.fname || '';

      const files: FirmwareFile[] = tree
        .filter((item) => {
          if (item.type !== 'blob') return false;
          const path = item.path;

          if (options.type === 'lua') {
            if (options.luaFolder === 'ethos') {
              // all files in lua/Ethos/ except README
              const filename = path.split('/').pop() || '';
              if (filename.toLowerCase().startsWith('readme')) return false;
              return path.includes('lua/Ethos/');
            } else {
              // only .lua files directly in lua/ (not in subfolders)
              if (!path.endsWith('.lua')) return false;
              return path.startsWith('lua/') && !path.includes('lua/Ethos/');
            }
          }

          // Filter by firmware directory
          const isFirmwarePath = path.includes('firmware/') || path.includes('pre-release-');
          if (!isFirmwarePath) return false;
          
          // Filter by internal/external
          if (options.type === 'txint' && !path.includes('-internal-')) return false;
          if (options.type !== 'txint' && path.includes('-internal-')) return false;

          // Filter by device filename pattern (tx-matek, etc)
          const filename = path.split('/').pop() || '';
          if (fname && !filename.includes(fname)) return false;

          return true;
        })
        .map((item) => {
          const filename = item.path.split('/').pop() || 'firmware.bin';
          // Use jsDelivr for raw file downloads to avoid rate limits
          const cachedVersions = getCached<Version[]>('versions');
          const versionObj = cachedVersions?.find((v) => v.version === options.version);
          const ref = versionObj?.commit || 'main';
          const rawUrl = `https://cdn.jsdelivr.net/gh/${REPO_OWNER}/${REPO_NAME}@${ref}/${item.path}`;

          return {
            filename,
            path: item.path,
            url: rawUrl,
            size: item.size
          };
        });

      return { files };
    } catch (e) {
      console.error('Failed to list firmware:', e);
      return { files: [] };
    }
  },

  getMetadata: async (options: { type: string, device: string, filename: string }): Promise<FirmwareMetadata | null> => {
    const { targetDict, deviceDict } = getDeviceInfo(options.device, options.type);
    if (!deviceDict || Object.keys(deviceDict).length === 0) return null;

    const chipset = resolveChipset(deviceDict, targetDict, options.filename);
    
    // Override chipset if flashing wireless bridge firmware
    // Filename format: mlrs-wireless-bridge-<chipset>.ino.bin
    if (options.filename.includes('mlrs-wireless-bridge-')) {
        const match = options.filename.match(/mlrs-wireless-bridge-([a-z0-9]+)/);
        if (match && match[1]) {
            // override the resolved chipset (which is likely the main MCU)
            // with the bridge chipset (e.g. esp32c3)
            return {
                 chipset: match[1],
                 flashmethod: 'esptool',
                 raw_flashmethod: 'esptool',
                 description: 'Flashing Wireless Bridge',
                 needsPort: true,
                 programmer: 'esptool',
                 hasWirelessBridge: true,
                 isWirelessBridgeFirmware: true,
                 wireless: targetDict.wireless
            };
        }
    }
    
    // Infer default flash method from chipset if not specified
    let defaultFlashMethod = 'stlink';
    if (chipset.includes('esp')) {
      defaultFlashMethod = 'esptool';
    }
    
    let flashmethod = targetDict.flashmethod || defaultFlashMethod;
    let description = targetDict.description || '';
    let wireless = targetDict.wireless;
    let erase = targetDict.erase;

    // Check for nested overrides in targetDict
    for (const key in targetDict) {
      if (options.filename.includes(key)) {
        const subDict = targetDict[key];
        if (typeof subDict === 'object') {
          if (subDict.flashmethod) flashmethod = subDict.flashmethod;
          if (subDict.description) description = subDict.description;
          if (subDict.wireless) wireless = subDict.wireless;
          if (subDict.erase) erase = subDict.erase;
        }
        break;
      }
    }

    let programmer = chipset;
    if (chipset.includes('stm32')) {
      if (flashmethod.includes('dfu')) programmer = 'stm32 dfu';
      else if (flashmethod.includes('uart')) programmer = 'stm32 uart';
      else programmer = 'stm32 stlink';
    }

    let needsPort = false;
    if (options.type === 'txint') {
      if (!programmer.includes('internal') && !programmer.includes('stm32')) {
        programmer += ' internal';
      }
    } else {
      needsPort = flashmethod.includes('uart') || flashmethod.includes('esptool') || programmer.includes('esp');
    }

    return {
      chipset,
      flashmethod,
      raw_flashmethod: flashmethod,
      description,
      needsPort,
      programmer,
      hasWirelessBridge: !!wireless,
      wireless,
      erase,
      isWirelessBridgeFirmware: false
    };
  }
};
