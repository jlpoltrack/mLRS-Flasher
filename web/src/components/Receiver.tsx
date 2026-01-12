import FirmwareFlasherPanel from './FirmwareFlasherPanel';

function Receiver(props: any) {
  return (
    <FirmwareFlasherPanel
      title="Receiver"
      targetType="rx"
      showSerialX={true}
      allowWirelessBridge={false}
      {...props}
    />
  );
}

export default Receiver;
