const { TableClient } = require("@azure/data-tables");
const { v4: uuidv4 } = require("uuid");

// Tables
const BOARDS_TABLE = "Boards";
const SQUARES_TABLE = "Squares";

// Storage connection (SWA Functions provides AzureWebJobsStorage)
function getConnString() {
  const cs = process.env.AzureWebJobsStorage;
  if (!cs) throw new Error("Missing AzureWebJobsStorage env var.");
  return cs;
}

function getTableClient(tableName) {
  return TableClient.fromConnectionString(getConnString(), tableName);
}

async function ensureTables() {
  const boards = getTableClient(BOARDS_TABLE);
  const squares = getTableClient(SQUARES_TABLE);
  await boards.createTable().catch(() => {});
  await squares.createTable().catch(() => {});
  return { boards, squares };
}

function ok(res, body) {
  res.status = 200;
  res.headers = { "Content-Type": "application/json" };
  res.body = body;
  return res;
}

function bad(res, status, message, extra) {
  res.status = status;
  res.headers = { "Content-Type": "application/json" };
  res.body = { ok: false, error: message, ...(extra || {}) };
  return res;
}

function parseJsonBody(req) {
  // Azure Functions Node sometimes gives object, sometimes string
  if (req.body == null) return null;
  if (typeof req.body === "object") return req.body;
  try {
    return JSON.parse(req.body);
  } catch {
    return null;
  }
}

function normalizeBoardId(id) {
  if (!id) return "";
  return String(id).trim();
}

// Entity helpers
function boardEntity(board) {
  return {
    partitionKey: "board",
    rowKey: board.boardId,
    boardId: board.boardId,
    pricePerSquare: Number(board.pricePerSquare || 0),
    paymentLabel: board.paymentLabel || "Venmo",
    paymentHandle: board.paymentHandle || "",
    title: board.title || "",
    subtitle: board.subtitle || "",
    // optional theme fields (store but ignore if empty)
    themeLogoDataUrl: board.themeLogoDataUrl || "",
    themeAccent: board.themeAccent || "",
    themeBg: board.themeBg || "",
    createdUtc: new Date().toISOString()
  };
}

function squareEntity(boardId, n) {
  return {
    partitionKey: boardId,
    rowKey: String(n),
    boardId,
    squareNumber: n,
    status: "open",        // open | taken
    displayName: "",       // public
    claimId: "",           // internal
    claimedUtc: ""
  };
}

async function createBoardAndSquares({ boards, squares }, payload) {
  // payload: { boardId, pricePerSquare, paymentHandle, paymentLabel, title, subtitle, ... }
  const boardId = normalizeBoardId(payload.boardId) || `board-${uuidv4().slice(0, 8)}`;

  const board = {
    boardId,
    pricePerSquare: payload.pricePerSquare ?? payload.price ?? 20,
    paymentLabel: payload.paymentLabel ?? "Venmo",
    paymentHandle: payload.paymentHandle ?? "",
    title: payload.title ?? "",
    subtitle: payload.subtitle ?? "",
    themeLogoDataUrl: payload.themeLogoDataUrl ?? "",
    themeAccent: payload.themeAccent ?? "",
    themeBg: payload.themeBg ?? ""
  };

  // Upsert board
  await boards.upsertEntity(boardEntity(board), "Replace");

  // Create 100 squares (1..100) idempotently: upsert
  const batch = [];
  for (let i = 1; i <= 100; i++) batch.push(squareEntity(boardId, i));

  // Data Tables SDK supports submitTransaction (max 100 ops per batch) - perfect.
  const tx = batch.map((e) => ["upsert", e, "Replace"]);
  await squares.submitTransaction(tx);

  return boardId;
}

async function getBoard({ boards, squares }, boardId) {
  // Board
  let board;
  try {
    const be = await boards.getEntity("board", boardId);
    board = {
      boardId: be.boardId,
      pricePerSquare: be.pricePerSquare,
      paymentLabel: be.paymentLabel,
      paymentHandle: be.paymentHandle,
      title: be.title,
      subtitle: be.subtitle,
      themeLogoDataUrl: be.themeLogoDataUrl,
      themeAccent: be.themeAccent,
      themeBg: be.themeBg
    };
  } catch (e) {
    return null;
  }

  // Squares (public view: only number/status/displayName)
  const sq = [];
  const iter = squares.listEntities({
    queryOptions: { filter: `PartitionKey eq '${boardId}'` }
  });

  for await (const s of iter) {
    sq.push({
      squareNumber: Number(s.squareNumber),
      status: s.status,
      displayName: s.displayName || ""
    });
  }

  // Ensure stable order 1..100
  sq.sort((a, b) => a.squareNumber - b.squareNumber);

  return { board, squares: sq };
}

module.exports = async function (context, req) {
  const res = {};

  try {
    const { boards, squares } = await ensureTables();

    const method = (req.method || "").toUpperCase();

    // GET /api/board/{boardId}
    if (method === "GET") {
      const boardId = normalizeBoardId(req.params?.boardId);
      if (!boardId) return bad(res, 400, "boardId is required (GET /api/board/{boardId})");

      const data = await getBoard({ boards, squares }, boardId);
      if (!data) return bad(res, 404, "Board not found");

      return ok(res, { ok: true, ...data });
    }

    // POST /api/board
    if (method === "POST") {
      const payload = parseJsonBody(req) || {};
      const createdBoardId = await createBoardAndSquares({ boards, squares }, payload);

      return ok(res, {
        ok: true,
        boardId: createdBoardId,
        urlPath: `/boardId-${createdBoardId}`
      });
    }

    return bad(res, 405, "Method not allowed");
  } catch (err) {
    return bad(res, 500, "Server error", { detail: String(err?.message || err) });
  }
};
