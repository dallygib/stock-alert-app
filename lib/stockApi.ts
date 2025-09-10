

// Returns both current price and previous close
export async function getStockQuote(symbol: string): Promise<{ current: number; previousClose: number }> {
  const API_KEY = process.env.FINNHUB_API_KEY;
  const url = `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${API_KEY}`;

  const res = await fetch(url);
  const data = await res.json();

  if (!res.ok || typeof data.c !== 'number' || typeof data.pc !== 'number') {
    throw new Error("Error fetching stock quote");
  }
  return { current: data.c, previousClose: data.pc };
}
