import { createModal } from "@buiducnhat/better-modal";
import type { DesktopBridge, ToolSummary } from "@workspace/shared";
import { Badge } from "@workspace/ui/components/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@workspace/ui/components/item";
import { Spinner } from "@workspace/ui/components/spinner";
import { useQuery } from "@tanstack/react-query";

import { toolsQuery } from "@/lib/queries";

type ToolsModalProps = { bridge: DesktopBridge };

const TIER_LABEL = { read: "Runs freely", write: "Asks first", exec: "Asks first" } as const;

function groupBySource(tools: ToolSummary[]) {
  const groups = new Map<string, ToolSummary[]>();
  for (const tool of tools) {
    const list = groups.get(tool.source) ?? [];
    list.push(tool);
    groups.set(tool.source, list);
  }
  return [...groups];
}

/** Read-only overview so people (and the tech team) can see what the agent can reach. */
export const ToolsModal = createModal<ToolsModalProps, void>("tools", ({ modal, bridge }) => {
  const tools = useQuery({ ...toolsQuery(bridge), enabled: modal.visible });
  return (
    <Dialog open={modal.visible} onOpenChange={(open) => !open && modal.resolve(undefined)}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Tools and connections</DialogTitle>
          <DialogDescription>
            What the agent can use. Your tech team adds business systems in the app's{" "}
            <code>agent/mcp.json</code>.
          </DialogDescription>
        </DialogHeader>
        {tools.isPending ? (
          <Spinner />
        ) : (
          <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
            {groupBySource(tools.data ?? []).map(([source, list]) => (
              <section key={source} className="flex flex-col gap-2">
                <h3 className="text-xs font-medium text-muted-foreground uppercase">
                  {source === "built-in" ? "Built in" : source}
                </h3>
                <ItemGroup>
                  {list.map((tool) => (
                    <Item key={tool.name} variant="outline" size="sm">
                      <ItemContent className="min-w-0">
                        <ItemTitle className="font-mono text-xs">{tool.name}</ItemTitle>
                        <ItemDescription className="line-clamp-2">
                          {tool.description}
                        </ItemDescription>
                      </ItemContent>
                      <Badge variant={tool.tier === "read" ? "secondary" : "outline"}>
                        {TIER_LABEL[tool.tier]}
                      </Badge>
                    </Item>
                  ))}
                </ItemGroup>
              </section>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
});
