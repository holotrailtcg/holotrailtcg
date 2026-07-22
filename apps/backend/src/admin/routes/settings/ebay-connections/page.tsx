import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Container, Heading, Text, toast } from "@medusajs/ui"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useSearchParams } from "react-router-dom"
import ConnectionCard from "../../../components/ebay/connection-card"
import type { EbayConnectionStatusResponse, EbayEnvironment } from "../../../components/ebay/connection-types"
import { fetchJson, postAction } from "../../../components/imports/fetch-json"
import { ebayCallbackResultMessage } from "./callback-result"

const QUERY_KEY = ["ebay-connection-status"]

const EbayConnectionPage = () => {
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => fetchJson<EbayConnectionStatusResponse>("/admin/ebay/connections"),
  })

  const connect = useMutation({
    mutationFn: (input: { environment: EbayEnvironment; reconnect: boolean }) =>
      postAction<{ authorisationUrl: string }>("/admin/ebay/connections", {
        ...input,
        confirmProduction: input.environment === "PRODUCTION",
      }),
    onSuccess: ({ authorisationUrl }) => window.location.assign(authorisationUrl),
    onError: () => toast.error("The eBay connection could not be started."),
  })
  const disconnect = useMutation({
    mutationFn: (environment: EbayEnvironment) => postAction("/admin/ebay/connections/disconnect", {
      environment, confirm: true, confirmProduction: environment === "PRODUCTION",
    }),
    onSuccess: () => {
      toast.success("eBay connection removed")
      queryClient.invalidateQueries({ queryKey: QUERY_KEY })
    },
    onError: () => toast.error("The eBay connection could not be removed."),
  })

  const callbackResult = searchParams.get("result")
  const callbackMessage = ebayCallbackResultMessage(callbackResult)

  return (
    <div className="flex flex-col gap-6">
      <Container className="flex flex-col gap-2 p-6">
        <Heading level="h1">eBay connections</Heading>
        <Text className="text-ui-fg-subtle">
          Authorise Holo Trail to identify an eBay seller account. Sandbox and Production remain completely isolated.
        </Text>
        {callbackMessage && <Text role="status">{callbackMessage}</Text>}
        {query.data && !query.data.enabled && <Text role="alert">eBay connections are disabled on this backend.</Text>}
        {query.isError && <Text role="alert">Connection status could not be loaded.</Text>}
      </Container>

      {query.data?.environments.map((environment) => (
        <ConnectionCard
          key={environment.environment}
          value={environment}
          busy={connect.isPending || disconnect.isPending}
          onConnect={(reconnect) => connect.mutateAsync({ environment: environment.environment, reconnect }).then(() => undefined)}
          onDisconnect={() => disconnect.mutateAsync(environment.environment).then(() => undefined)}
        />
      ))}
    </div>
  )
}

export const config = defineRouteConfig({
  label: "eBay connections",
})

export default EbayConnectionPage
