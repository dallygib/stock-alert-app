import fetch from "node-fetch";
import fs from "fs";
import path from "path";

// Top-level await to ensure dotenv is loaded before accessing process.env
await import("dotenv").then((dotenv) => dotenv.config());

const FMP_API_KEY = process.env.FMP_API_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const PRICE_LIMIT = 20;

// Get session from command line argument (default: open)
const session = process.argv[2] || "open";
const validSessions = ["premarket", "open", "afterhours"];
const sessionLabel = validSessions.includes(session) ? session : "open";
const LAST_GAINERS_PATH = path.resolve(
  path.dirname(
    new URL(import.meta.url).pathname.replace(/^\/+([A-Za-z]:)/, "$1")
  ),
  `lastGainers_${sessionLabel}.json`
);

async function sendTelegramMessage(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text }),
  });
}

async function main() {
  console.log(
    `\n=== Scanning Market Session: ${sessionLabel.toUpperCase()} ===\n`
  );
  // await sendTelegramMessage("Test alert: Telegram integration is working!");
  if (!FMP_API_KEY) {
    console.error("FMP_API_KEY is not set in .env");
    return;
  }
  const url = `https://financialmodelingprep.com/stable/biggest-gainers?apikey=${FMP_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error("Failed to fetch FMP top gainers", await res.text());
    return;
  }
  const gainers = await res.json();
  // Load last gainers from session file, or fallback to lastGainers.json
  let lastGainers = {};
  if (fs.existsSync(LAST_GAINERS_PATH)) {
    try {
      lastGainers = JSON.parse(fs.readFileSync(LAST_GAINERS_PATH, "utf-8"));
    } catch {
      lastGainers = {};
    }
  } else {
    // fallback to lastGainers.json if session file does not exist
    const fallbackPath = path.resolve(
      path.dirname(LAST_GAINERS_PATH),
      "lastGainers.json"
    );
    if (fs.existsSync(fallbackPath)) {
      try {
        lastGainers = JSON.parse(fs.readFileSync(fallbackPath, "utf-8"));
        console.log(`Falling back to lastGainers.json for initial state.`);
      } catch {
        lastGainers = {};
      }
    }
  }
  console.log("Loaded lastGainers:", lastGainers);

  // Merge new alerts into lastGainers.json so only new or improved gainers are tracked
  let updatedGainers = { ...lastGainers };
  let alertSent = false;
  let firstAlert = true;
  for (const stock of gainers) {
    const price = stock.price || stock.lastPrice;
    let percentGain = 0;
    if (stock.changesPercentage) {
      percentGain = parseFloat(
        String(stock.changesPercentage).replace(/[^\d.-]/g, "")
      );
    } else if (stock.changes) {
      percentGain = parseFloat(String(stock.changes).replace(/[^\d.-]/g, ""));
    } else if (stock.change) {
      percentGain = parseFloat(String(stock.change).replace(/[^\d.-]/g, ""));
    }
    const symbol = (stock.ticker || stock.symbol || "").toUpperCase().trim();
    if (price && price < PRICE_LIMIT && percentGain > 40) {
      // Fact-check for very high gainers
      const previousClose = stock.previousClose;
      let calcPercent = null;
      if (
        typeof price === "number" &&
        typeof previousClose === "number" &&
        previousClose !== 0
      ) {
        calcPercent = ((price - previousClose) / previousClose) * 100;
      }
      if (percentGain > 500 && calcPercent !== null) {
        const absDiff = Math.abs(percentGain - calcPercent);
        console.log(
          `FACT CHECK: ${symbol} API percent: ${percentGain}%, Calculated percent: ${calcPercent}%`
        );
        if (absDiff > 10) {
          console.log(
            `FILTERED: ${symbol} - High gainer, API percent (${percentGain}%) does not match calculated percent (${calcPercent}%). Skipping.`
          );
          continue;
        }
      }
      // Only alert if new or gain increased by more than 5% (never for decreases)
      if (
        !lastGainers[symbol] ||
        percentGain > lastGainers[symbol].percentGain + 5
      ) {
        const previousClose = stock.previousClose;
        let apiPercent = null;
        if (
          stock.changesPercentage !== undefined &&
          stock.changesPercentage !== null
        ) {
          apiPercent = parseFloat(
            String(stock.changesPercentage).replace(/[^\d.-]/g, "")
          );
          percentGain = apiPercent;
        } else if (stock.changes) {
          percentGain = parseFloat(
            String(stock.changes).replace(/[^\d.-]/g, "")
          );
        } else if (stock.change) {
          percentGain = parseFloat(
            String(stock.change).replace(/[^\d.-]/g, "")
          );
        }
        // Calculate our own percent gain if possible
        let calcPercent = null;
        if (
          typeof price === "number" &&
          typeof previousClose === "number" &&
          previousClose !== 0
        ) {
          calcPercent = ((price - previousClose) / previousClose) * 100;
        }
        // If both API and calculated percent exist, compare them
        if (apiPercent !== null && calcPercent !== null) {
          const absDiff = Math.abs(apiPercent - calcPercent);
          const relDiff =
            Math.abs(apiPercent - calcPercent) /
            Math.max(Math.abs(calcPercent), 1);
          if (absDiff > 20 && relDiff > 1) {
            console.log(
              `FILTERED: ${stock.symbol} - API percent (${apiPercent}%) does not match calculated percent (${calcPercent}%). Skipping.`
            );
            continue;
          }
        }
        if (!lastGainers[symbol]) {
          console.log(`ALERT: ${symbol} is new. Sending alert.`);
        } else {
          const diff = (percentGain - lastGainers[symbol].percentGain).toFixed(
            2
          );
          console.log(
            `ALERT: ${symbol} increased by ${diff}% (from ${lastGainers[symbol].percentGain}% to ${percentGain}%). Sending alert.`
          );
        }
        let comparison = "";
        if (lastGainers[symbol]) {
          const diff = (percentGain - lastGainers[symbol].percentGain).toFixed(
            2
          );
          comparison = ` (up ${diff}% from previous alert)`;
        }
        let highlight = "";
        if (percentGain >= 500) {
          highlight = "🚨🚨🚨 500%+ GAINER! 🚨🚨🚨\n";
        } else if (percentGain >= 100) {
          highlight = "🔥 100%+ GAINER! 🔥\n";
        }
        // Send separator before the first alert
        if (firstAlert) {
          await sendTelegramMessage("***NEW ALERT***");
          firstAlert = false;
        }
        const msg = `${highlight}Top Gainer Under $${PRICE_LIMIT} & >40% [${sessionLabel.toUpperCase()}]: ${symbol}\nPrice: $${price}\nChange: ${percentGain}%${comparison}\nName: ${
          stock.companyName || stock.name || ""
        }
        }\n${stock.exchange || ""}`;
        console.log(msg);
        await sendTelegramMessage(msg);
        updatedGainers[symbol] = { price, percentGain };
        alertSent = true;
      } else {
        if (lastGainers[symbol]) {
          const diff = (percentGain - lastGainers[symbol].percentGain).toFixed(
            2
          );
          if (percentGain <= lastGainers[symbol].percentGain) {
            console.log(
              `SKIP: ${symbol} gain decreased or stayed the same (${lastGainers[symbol].percentGain}% -> ${percentGain}%). No alert.`
            );
          } else {
            console.log(
              `SKIP: ${symbol} gain increased by only ${diff}%. No alert.`
            );
          }
        }
      }
    }
  }
  // If no alerts were sent, print a message and send a heartbeat alert
  if (!alertSent) {
    const msg = `No new or improved gainers found for >40% [${sessionLabel.toUpperCase()}]. (Heartbeat)`;
    console.log(msg);
    await sendTelegramMessage(msg);
  }
  // Ensure directory exists before writing
  const dir = path.dirname(LAST_GAINERS_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  // Save merged gainers to file for next run
  fs.writeFileSync(LAST_GAINERS_PATH, JSON.stringify(updatedGainers, null, 2));
  console.log("Updated lastGainers:", updatedGainers);
  // Only new/improved gainers will trigger alerts and be tracked
}

main().catch(console.error);
