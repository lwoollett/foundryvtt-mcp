/**
 * @fileoverview Actor attribute mutation tool handlers (#143)
 *
 * Handles patching attributes on an actor's `system` object via dot-paths.
 * WRITE operation — requires FOUNDRY_WRITE_ENABLED=true and an active Socket.IO
 * connection (mutations use the core `modifyDocument` protocol).
 */

import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import type { AttributePatch, FoundryClient } from '../../foundry/client.js';
import { withToolError } from './utils.js';

/**
 * Handles actor attribute update requests.
 *
 * `patch` keys are dot-paths into the actor's `system` object — e.g.
 * `attributes.hp.value`, `attributes.hp.temp`, `currency.gp`,
 * `resources.primary.value`, `spells.spell1.value`, `attributes.exhaustion`.
 * The post-update value of every patched path is echoed back.
 */
export async function handleUpdateActorAttribute(
  args: {
    actorId: string;
    patch: AttributePatch;
  },
  foundryClient: FoundryClient,
) {
  const { actorId, patch } = args;

  if (!actorId || typeof actorId !== 'string') {
    throw new McpError(ErrorCode.InvalidParams, 'actorId is required and must be a string');
  }
  if (
    patch === null ||
    typeof patch !== 'object' ||
    Array.isArray(patch) ||
    Object.keys(patch).length === 0
  ) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'patch is required and must be a non-empty object of dot-path attributes',
    );
  }

  return withToolError('update actor attributes', async () => {
    const result = await foundryClient.updateActorAttribute(actorId, patch);

    const updatedList = Object.entries(result.updatedAttributes)
      .map(([path, value]) => `- **${path}** → ${String(value)}`)
      .join('\n');

    return {
      content: [
        {
          type: 'text',
          text: `⚔️ **Actor Attributes Updated**
**Actor ID:** ${actorId}
**Status:** ${result.success ? 'Success' : 'Failed'}

**Updated attributes** (dot-paths into actor.system):
${updatedList}`,
        },
      ],
    };
  });
}

/**
 * Handles actor creation requests (e.g. bulk bestiary import).
 * WRITE operation — systemData/items pass through verbatim; the system
 * (e.g. SWADE) applies its own schema defaults on create.
 */
export async function handleCreateActor(
  args: {
    name: string;
    type: string;
    system?: Record<string, unknown>;
    items?: Array<Record<string, unknown>>;
    folder?: string;
  },
  foundryClient: FoundryClient,
) {
  return withToolError('create actor', async () => {
    const actor = await foundryClient.createActor(
      args.name,
      args.type,
      args.system,
      args.items,
      args.folder,
    );

    return {
      content: [
        {
          type: 'text',
          text: `🎭 **Actor Created**
**Name:** ${actor.name}
**ID:** ${actor._id}
**Type:** ${args.type}
**Items:** ${args.items?.length ?? 0}`,
        },
      ],
    };
  });
}

/**
 * Handles folder creation requests (e.g. biome folders for bestiary actors).
 * WRITE operation.
 */
export async function handleCreateFolder(
  args: { name: string; type: string; color?: string },
  foundryClient: FoundryClient,
) {
  return withToolError('create folder', async () => {
    const folder = (await foundryClient.createFolder(
      args.name,
      args.type,
      args.color,
    )) as { _id?: string; name?: string };

    return {
      content: [
        {
          type: 'text',
          text: `📁 **Folder Created**
**Name:** ${folder?.name ?? args.name}
**ID:** ${folder?._id ?? 'unknown'}
**Type:** ${args.type}`,
        },
      ],
    };
  });
}

/** Deletes an Actor by _id. WRITE operation. */
export async function handleDeleteActor(
  args: { actorId: string },
  foundryClient: FoundryClient,
) {
  return withToolError('delete actor', async () => {
    await (foundryClient as any).modifyDocument('Actor', 'delete', {
      ids: [args.actorId],
    });
    return {
      content: [{ type: 'text', text: `🗑️ **Actor Deleted:** ${args.actorId}` }],
    };
  });
}

/** Deletes a Folder by _id. WRITE operation. */
export async function handleDeleteFolder(
  args: { folderId: string },
  foundryClient: FoundryClient,
) {
  return withToolError('delete folder', async () => {
    await (foundryClient as any).modifyDocument('Folder', 'delete', {
      ids: [args.folderId],
    });
    return {
      content: [{ type: 'text', text: `🗑️ **Folder Deleted:** ${args.folderId}` }],
    };
  });
}


/** Creates a Scene (map) with optional grid + embedded notes. WRITE. */
export async function handleCreateScene(
  args: {
    name: string;
    img?: string;
    grid?: Record<string, unknown>;
    width?: number;
    height?: number;
    notes?: Array<Record<string, unknown>>;
  },
  foundryClient: FoundryClient,
) {
  return withToolError('create scene', async () => {
    const dims: { width?: number; height?: number } = {};
    if (args.width !== undefined) dims.width = args.width;
    if (args.height !== undefined) dims.height = args.height;
    const scene = (await foundryClient.createScene(
      args.name,
      args.img,
      args.grid,
      dims,
      args.notes,
    )) as { _id?: string; name?: string };
    return {
      content: [
        {
          type: 'text',
          text: `🗺️ **Scene Created**
**Name:** ${scene?.name ?? args.name}
**ID:** ${scene?._id ?? 'unknown'}`,
        },
      ],
    };
  });
}


/** Deletes a Scene by _id. WRITE. */
export async function handleDeleteScene(
  args: { sceneId: string },
  foundryClient: FoundryClient,
) {
  return withToolError('delete scene', async () => {
    await (foundryClient as any).modifyDocument('Scene', 'delete', { ids: [args.sceneId] });
    return { content: [{ type: 'text', text: `🗺️ **Scene Deleted:** ${args.sceneId}` }] };
  });
}
