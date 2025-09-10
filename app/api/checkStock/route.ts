
import { NextResponse } from "next/server";
import { getStockQuote } from "@/lib/stockApi";
import { sendTelegramMessage } from "@/lib/notifier";


const SYMBOL = "AAPL"; // You can make this dynamic if needed
const GAIN_THRESHOLD = 0.5; // 50%

export async function GET() {
  try {
    // getStockQuote returns { current, previousClose }
    const { current, previousClose } = await getStockQuote(SYMBOL);
    const gain = (current - previousClose) / previousClose;

    if (gain > GAIN_THRESHOLD) {
      await sendTelegramMessage(
        `${SYMBOL} has gained more than 50%! Current: $${current} (Prev Close: $${previousClose}, Gain: ${(gain * 100).toFixed(2)}%)`
      );
    }

    return NextResponse.json({ success: true, symbol: SYMBOL, current, previousClose, gain });
  } catch (error: unknown) {
    console.error(error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
