// api/src/functions/claim.js
const { app } = require("@azure/functions");
const { TableClient } = require("@azure/data-tables");
const { nanoid } = require("nanoid");

function storageConn() {
  return (
    process.env.AZURE_STORAGE_CONNECTION_STRING ||
    process.env.AzureWebJobsStorage ||
    process.env.AZUREWEBJOBSTORAGE ||
    "UseDevelopmentStorage=true"
  );
}

function getClient(tableName) {
  return TableClient.fromConnectionString(storageConn(), tableName);
}

async function ensureTable(tableName) {
  const client = getClient(tableName);
  try {
    await client.createTable();
  } catch (e) {
    if (e?.statusCode !== 409) throw e;
  }
  return client;
}

async function readJson(request) {
  const text = await request.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function bad(status, msg, extra = {}) {
  return { status, jsonBody: { ok: false, error: msg, ...extra } };
}

function normalizeSquareIds(input) {
  return (Array.isArray(input) ? input : [])
    .map((s) => String(s).trim())
    .filter(Boolean)
    .map((s) => s.padStart(3, "0"));
}

app.http("claim", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "claim",
  handler: async (request, context) => {
    const body = await readJson(request);

    const boardId = (body.boardId || "").trim();
    const displayName = (body.displayName || "").trim();
    const squareIds = normalizeSquareIds(body.squares);

    if (!boardId) return bad(400, "boardId required");
    if (!displayName) return bad(400, "displayName required");
    if (!squareIds.length) return bad(400, "squares[] required");

    const boards = getClient("Boards");
    const squaresTable = getClient("Squares");
    const claims = await ensureTable("Claims");

    // Board exists + active
    let board;
    try {
      board = await boards.getEntity("BOARD", boardId);
    } catch {
      return bad(404, "Board not found");
    }
    if (board.status && board.status !== "active") return bad(400, "Board not active");

    const max = Number(board.maxSquaresPerOrder || 0);
    if (max > 0 && squareIds.length > max) return bad(400, `Max squares per order is ${max}`);

    const claimId = nanoid(10);
    const now = new Date().toISOString();

    // Read squares (capture etag)
    const fetched = [];
    for (const id of squareIds) {
      try {
        const ent = await squaresTable.getEntity(boardId, id);
        fetched.push(ent);
      } catch {
        return bad(404, `Square not found: ${id}`);
      }
    }

    const notOpen = fetched.filter((s) => (s.status ?? "open") !== "open");
    if (notOpen.length) {
      return bad(409, "Some squares already taken", {
        taken: notOpen.map((s) => s.rowKey || s.RowKey),
      });
    }

    const claimEntity = {
      partitionKey: boardId,
      rowKey: claimId,

      boardId,
      claimId,
      displayName,
      squareIds: JSON.stringify(squareIds),
      status: "unpaid",
      createdAt: now,
      updatedAt: now,
    };

    try {
      await claims.createEntity(claimEntity);

      for (const ent of fetched) {
        const updated = {
          ...ent,
          partitionKey: ent.partitionKey, // keep keys intact
          rowKey: ent.rowKey,

          status: "taken",
          displayName,
          claimId,
          updatedAt: now,
        };

        await squaresTable.updateEntity(updated, "Replace", { etag: ent.etag });
      }
    } catch (e) {
      context.log("CLAIM ERROR:", e);

      if (e?.statusCode === 412) {
        return bad(409, "Square claim race condition — try again");
      }

      return {
        status: 500,
        jsonBody: {
          ok: false,
          message: e?.message || String(e),
          statusCode: e?.statusCode,
          code: e?.code,
          details: e?.details,
        },
      };
    }

    return {
      status: 200,
      jsonBody: { ok: true, boardId, claimId, displayName, squares: squareIds, status: "unpaid" },
    };
  },
});


