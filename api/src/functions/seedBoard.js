// api/src/functions/seedBoard.js
const { app } = require("@azure/functions");
const { TableClient } = require("@azure/data-tables");

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

app.http("seedBoard", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "seed/{boardId?}",
  handler: async (request, context) => {
    const boardId = (request.params.boardId || "test-board").trim();
    const now = new Date().toISOString();

    const boards = await ensureTable("Boards");
    const squares = await ensureTable("Squares");
    await ensureTable("Claims");

    // Board
    const boardEntity = {
      partitionKey: "BOARD",
      rowKey: boardId,

      boardId,
      title: "Test Board",
      teamName: "Doms",
      pricePerSquare: 20,
      maxSquaresPerOrder: 10,
      status: "active",
      showNamesPublicly: true,

      createdAt: now,
      updatedAt: now,
    };

    await boards.upsertEntity(boardEntity, "Replace");

    // Squares
    const ops = [];
    for (let n = 1; n <= 100; n++) {
      ops.push(
        squares.upsertEntity(
          {
            partitionKey: boardId,
            rowKey: String(n).padStart(3, "0"),

            squareNumber: n,
            status: "open",
            displayName: "",
            claimId: "",
            updatedAt: now,
          },
          "Replace"
        )
      );
    }
    await Promise.all(ops);

    return {
      status: 200,
      jsonBody: { ok: true, boardId, seededSquares: 100 },
    };
  },
});
