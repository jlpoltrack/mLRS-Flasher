import type { Version, FirmwareFile } from '../types';
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

// Cache for API responses
const cache: Record<string, any> = {};

export const githubApi = {
  listVersions: async (): Promise<Version[]> => {
    if (cache['versions']) return cache['versions'];

    try {
      const response = await fetch(FIRMWARE_JSON_URL);
      if (!response.ok) throw new Error('Failed to fetch versions');
      const data = await response.json();
      
      const versions: Version[] = [];
      
      // Add 'main' branch as a version for dev/latest
      versions.push({
        version: 'main',
        versionStr: 'main (dev)',
        commit: 'main',
        gitUrl: `https://github.com/${REPO_OWNER}/${REPO_NAME}/tree/main`
      });

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

      cache['versions'] = versions;
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

  listFirmware: async (options: { type: string, device?: string, version: string }): Promise<{ files: FirmwareFile[] }> => {
    const cacheKey = `firmware-${options.version}`;
    let tree: any[] = [];

    try {
      if (cache[cacheKey]) {
        tree = cache[cacheKey];
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
        const data = await response.json();
        tree = data.tree || [];
        cache[cacheKey] = tree;
      }

      const { deviceDict } = getDeviceInfo(options.device || '', options.type);
      const fname = deviceDict.fname || '';

      const files: FirmwareFile[] = tree
        .filter((item: any) => {
          if (item.type !== 'blob') return false;
          const path = item.path;

          if (options.type === 'lua') {
            return path.includes('lua/') && path.endsWith('.lua');
          }

          // Filter by firmware directory (Python logic: 'firmware' or 'pre-release' in path)
          if (!path.includes('firmware') && !path.includes('pre-release')) return false;
          
          // Filter by internal/external
          if (options.type === 'txint' && !path.includes('-internal-')) return false;
          if (options.type !== 'txint' && path.includes('-internal-')) return false;

          // Filter by device filename pattern
          if (fname && !path.includes(fname)) return false;

          return true;
        })
        .map((item: any) => {
          const filename = item.path.split('/').pop();
          // Use jsDelivr for raw file downloads to avoid rate limits
          const versionObj = cache['versions']?.find((v: any) => v.version === options.version);
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

  getMetadata: async (options: { type: string, device: string, filename: string }): Promise<any> => {
    const { targetDict, deviceDict } = getDeviceInfo(options.device, options.type);
    if (!deviceDict || Object.keys(deviceDict).length === 0) return null;

    const chipset = resolveChipset(deviceDict, targetDict, options.filename);
    let flashmethod = targetDict.flashmethod || 'stlink';
    let description = targetDict.description || '';
    let wireless = targetDict.wireless;

    // Check for nested overrides in targetDict
    for (const key in targetDict) {
      if (options.filename.includes(key)) {
        const subDict = targetDict[key];
        if (typeof subDict === 'object') {
          if (subDict.flashmethod) flashmethod = subDict.flashmethod;
          if (subDict.description) description = subDict.description;
          if (subDict.wireless) wireless = subDict.wireless;
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
      hasWirelessBridge: !!wireless
    };
  }
};
