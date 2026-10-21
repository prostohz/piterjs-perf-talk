import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentRequest, CodingAgent } from "../types.js";
import { CodexConnection, type RpcMessage } from "./connection.js";

interface TurnNotification {
  threadId: string;
  item?: { type: string; text?: string; phase?: string | null };
  turn?: { status: string; error?: { message: string } | null };
}

export class CodexAgent implements CodingAgent {
  async version(): Promise<string> {
    const { stdout } = await promisify(execFile)("codex", ["--version"]);
    return stdout.trim();
  }

  async run(request: AgentRequest): Promise<unknown> {
    const { cwd, outputDirectory, settings, prompt, responseSchema, signal } =
      request;
    signal.throwIfAborted();
    const tools = request.tools;
    if (new Set(tools.map((tool) => tool.name)).size !== tools.length)
      throw new Error("Duplicate agent tool names");

    await mkdir(outputDirectory, { recursive: true });
    await writeFile(join(outputDirectory, "prompt.txt"), prompt);
    await writeFile(
      join(outputDirectory, "response.schema.json"),
      JSON.stringify(responseSchema),
    );
    const args = [
      "app-server",
      "--listen",
      "stdio://",
      "-c",
      "sandbox_workspace_write.writable_roots=[]",
    ];
    await writeFile(
      join(outputDirectory, "command.json"),
      JSON.stringify({ executable: "codex", args }, null, 2),
    );

    let threadId: string | undefined;
    let finalMessage: string | undefined;
    let resolveTurn!: () => void;
    const completed = new Promise<void>((resolve) => {
      resolveTurn = resolve;
    });

    async function handleRequest(message: RpcMessage): Promise<unknown> {
      if (message.method !== "item/tool/call")
        throw new Error(`Unexpected Codex request: ${message.method}`);
      const params = message.params as {
        threadId: string;
        tool: string;
        arguments: unknown;
      };
      if (params.threadId !== threadId)
        throw new Error("Tool call belongs to another session");
      const tool = tools.find((candidate) => candidate.name === params.tool);
      if (!tool) throw new Error(`Unknown agent tool: ${params.tool}`);
      const result = await tool.execute(params.arguments);
      return {
        contentItems: [{ type: "inputText", text: result.text }],
        success: result.success,
      };
    }

    function handleNotification(message: RpcMessage): void {
      if (message.method === "error")
        throw new Error(`Codex error: ${JSON.stringify(message.params)}`);
      const params = message.params as TurnNotification;
      if (!params || params.threadId !== threadId) return;
      if (
        message.method === "item/completed" &&
        params.item?.type === "agentMessage" &&
        params.item.phase !== "commentary"
      )
        finalMessage = params.item.text;
      if (message.method === "turn/completed") {
        if (params.turn?.status !== "completed")
          throw new Error(
            `Codex did not complete successfully: ${params.turn?.error?.message ?? params.turn?.status}`,
          );
        resolveTurn();
      }
    }

    const connection = new CodexConnection(
      args,
      cwd,
      outputDirectory,
      signal,
      handleRequest,
      handleNotification,
    );
    try {
      await connection.request("initialize", {
        clientInfo: { name: "performance_pipeline", version: "0.1.0" },
        capabilities: { experimentalApi: true },
      });
      connection.notify("initialized");
      const started = (await connection.request("thread/start", {
        cwd,
        model: settings.model,
        approvalPolicy: "never",
        sandbox: "workspace-write",
        ephemeral: true,
        dynamicTools: tools.map(({ name, description, inputSchema }) => ({
          type: "function",
          name,
          description,
          inputSchema,
        })),
      })) as { thread: { id: string } };
      threadId = started.thread.id;
      if (typeof threadId !== "string" || !threadId)
        throw new Error("Codex returned no session id");
      await writeFile(
        join(outputDirectory, "session.json"),
        JSON.stringify({ threadId }),
      );

      await connection.request("turn/start", {
        threadId,
        input: [{ type: "text", text: prompt, text_elements: [] }],
        effort: settings.reasoningEffort,
        outputSchema: responseSchema,
      });
      await connection.until(completed);
      signal.throwIfAborted();
      if (!finalMessage) throw new Error("Codex returned no final response");
      const response = JSON.parse(finalMessage) as unknown;
      await writeFile(
        join(outputDirectory, "response.json"),
        `${JSON.stringify(response, null, 2)}\n`,
      );
      return response;
    } finally {
      await connection.close();
    }
  }
}
