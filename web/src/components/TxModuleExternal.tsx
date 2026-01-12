import FirmwareFlasherPanel from './FirmwareFlasherPanel';

function TxModuleExternal(props: any) {
  return (
    <FirmwareFlasherPanel
      title="Tx Module (External)"
      targetType="tx"
      showSerialX={false}
      allowWirelessBridge={true}
      {...props}
    />
  );
}

export default TxModuleExternal;
