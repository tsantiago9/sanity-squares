// api/src/functions/getBoard.js
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

function toRowColFromSquareNumber(n) {
  const idx = Number(n) - 1;
  return { row: Math.floor(idx / 10), col: idx % 10 };
}

app.http("getBoard", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "board/{boardId}",
  handler: async (request, context) => {
    const boardId = (request.params.boardId || "").trim();
    if (!boardId) return { status: 400, jsonBody: { ok: false, error: "boardId required" } };

    const boards = getClient("Boards");
    const squaresTable = getClient("Squares");

    let board;
    try {
      board = await boards.getEntity("BOARD", boardId);
    } catch {
      return { status: 404, jsonBody: { ok: false, error: "Board not found" } };
    }

    const squares = [];
    const filter = `PartitionKey eq '${boardId.replace(/'/g, "''")}'`;

    for await (const ent of squaresTable.listEntities({ queryOptions: { filter } })) {
      // SDK returns PartitionKey/RowKey in query results; but entity object also carries rowKey sometimes.
      const rk = ent.rowKey || ent.RowKey; // be tolerant
      const squareNumber = ent.squareNumber ?? Number(rk);
      const { row, col } = toRowColFromSquareNumber(squareNumber);

      squares.push({
        id: rk,
        squareNumber,
        row,
        col,
        status: ent.status ?? "open",
        displayName: ent.displayName || "",
        claimId: ent.claimId || "",
      });
    }

    squares.sort((a, b) => a.squareNumber - b.squareNumber);

    const showNamesPublicly =
      typeof board.showNamesPublicly === "boolean"
        ? board.showNamesPublicly
        : String(board.showNamesPublicly).toLowerCase() === "true" ||
          String(board.showNamesPublicly).toLowerCase() === "yes";

    return {
      status: 200,
      jsonBody: {
        ok: true,
        board: {
          id: boardId,
          title: board.title,
          teamName: board.teamName,
          pricePerSquare: board.pricePerSquare,
          maxSquaresPerOrder: board.maxSquaresPerOrder,
          paymentLabel: board.paymentLabel,
          paymentHandle: board.paymentHandle,
          showNamesPublicly,
          status: board.status,
        },
        squares,
      },
    };
  },
});

