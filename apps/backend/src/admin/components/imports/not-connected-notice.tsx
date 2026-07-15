import { InlineTip } from "@medusajs/ui"

interface NotConnectedNoticeProps {
  message: string
}

const NotConnectedNotice = ({ message }: NotConnectedNoticeProps) => {
  return (
    <InlineTip label="Not connected yet" variant="warning">
      {message}
    </InlineTip>
  )
}

export default NotConnectedNotice
