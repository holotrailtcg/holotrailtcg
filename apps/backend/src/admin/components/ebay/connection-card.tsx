import { Badge, Button, Container, Heading, Text, usePrompt } from "@medusajs/ui"
import type { EbayEnvironmentStatusDto } from "./connection-types"

interface EbayConnectionCardProps {
  value: EbayEnvironmentStatusDto
  busy: boolean
  onConnect: (reconnect: boolean) => Promise<void>
  onDisconnect: () => Promise<void>
}

function formattedDate(value: string | null): string {
  return value ? new Date(value).toLocaleString("en-GB") : "Not yet"
}

export default function EbayConnectionCard({ value, busy, onConnect, onDisconnect }: EbayConnectionCardProps) {
  const prompt = usePrompt()
  const production = value.environment === "PRODUCTION"
  const connection = value.connection
  const connected = connection?.status === "CONNECTED"
  const degraded = connection?.status === "DEGRADED"
  const statusLabel = degraded ? "Connected with issue" : connection?.status ?? "Not connected"
  const degradedMessage = connection?.lastSafeErrorCategory === "USER_DENIED"
    ? "The latest reconnect was cancelled. The saved authorisation is retained; reconnect again only if you want to replace it."
    : "eBay is temporarily unavailable. The saved authorisation is retained and will be retried; renewed consent is not currently required."

  const connect = async () => {
    if (production) {
      const confirmed = await prompt({
        title: `Connect eBay Production?`,
        description: "This authorises access to the live seller account. Stage E1 cannot create or publish listings.",
        confirmText: "Continue to eBay",
        cancelText: "Cancel",
      })
      if (!confirmed) return
    }
    await onConnect(Boolean(connection))
  }

  const disconnect = async () => {
    const confirmed = await prompt({
      title: `Disconnect eBay ${production ? "Production" : "Sandbox"}?`,
      description: "Holo Trail will remove its locally usable credential. Connection history will be retained.",
      confirmText: "Disconnect",
      cancelText: "Cancel",
      variant: "danger",
    })
    if (confirmed) await onDisconnect()
  }

  return (
    <Container className={`flex flex-col gap-4 border-l-4 p-6 ${production ? "border-l-ui-tag-red-border" : "border-l-ui-tag-blue-border"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Heading level="h2">eBay {production ? "Production" : "Sandbox"}</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            {production ? "Live seller environment" : "Test seller environment"}
          </Text>
        </div>
        <Badge color={connected ? "green" : value.configured ? "orange" : "grey"}>
          {!value.configured ? "Not configured" : statusLabel}
        </Badge>
      </div>

      <dl className="grid grid-cols-1 gap-2 text-ui-fg-subtle sm:grid-cols-2">
        <div><dt className="font-medium">Account</dt><dd>{connection?.displayName ?? connection?.ebayAccountId ?? "Not connected"}</dd></div>
        <div><dt className="font-medium">Connected</dt><dd>{formattedDate(connection?.connectedAt ?? null)}</dd></div>
        <div><dt className="font-medium">Last refresh</dt><dd>{formattedDate(connection?.lastRefreshAt ?? null)}</dd></div>
        <div><dt className="font-medium">Granted scopes</dt><dd>{connection?.grantedScopes.length ?? 0}</dd></div>
      </dl>

      {(connection?.lastSafeErrorCategory || value.reconnectRequired) && (
        <Text role="alert" size="small">
          {degraded
            ? degradedMessage
            : value.reconnectRequired
              ? "Renewed eBay consent is required. Reconnect this environment to continue."
              : `Connection attention required: ${connection?.lastSafeErrorCategory?.replaceAll("_", " ").toLowerCase() ?? "unknown"}.`}
        </Text>
      )}
      <Text size="small" className="text-ui-fg-subtle">
        Connecting does not create, revise or publish any eBay listing. Pulse approval never publishes to eBay.
      </Text>

      <div className="flex flex-wrap gap-2">
        <Button size="small" variant="primary" disabled={!value.configured || busy} isLoading={busy} onClick={connect}>
          {connection ? "Reconnect" : "Connect"}
        </Button>
        <Button size="small" variant="danger" disabled={!connection || busy || connection.status === "DISCONNECTED" || connection.status === "REVOKED"} onClick={disconnect}>
          {connection?.status === "DISCONNECTING" ? "Retry disconnect" : "Disconnect"}
        </Button>
      </div>
    </Container>
  )
}
