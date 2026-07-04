
import express from "express";
import { paymentMiddleware } from "x402-express";
import { privateKeyToAccount } from "viem/accounts";
import "dotenv/config";

const PORT = 4021;

const payTo = privateKeyToAccount(process.env.KUDZU_PRIVATE_KEY as `0x${string}`).address;

const app = express();
app.use(
  paymentMiddleware(
    payTo,
    { "GET /rates": { price: "$0.001", network: "base-sepolia" } },
    { url: "https://x402.org/facilitator" },
  ),
);
app.get("/rates", (_req, res) => res.json({ pair: "USD/EUR", rate: 0.92, ts: Date.now() }));

app.listen(PORT, () => process.stderr.write(`x402 seller on http://localhost:${PORT}/rates (pays ${payTo})\n`));
