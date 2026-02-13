import { file } from "bun";
import * as path from "path";
import { PDFParse } from "pdf-parse";

// 1. Refined JSON Data Structures
interface ReportData {
  title: string;
  sourceFile: string;
  commentary: string[];
  mocData: MocSection[];
}

interface MocSection {
  type: "Trades" | "Bids" | "Offers" | "Withdrawals" | "Other";
  heading: string;
  entries: ParsedMocEntry[];
}

// New Interface for Structured MOC Data
interface ParsedMocEntry {
  rawText: string;
  company?: string;
  action?: string;
  price?: string;
  quantity?: string;
}

export async function parsePlattsPDF(filePath: string): Promise<ReportData> {
  const arrayBuffer = await file(filePath).arrayBuffer();
  const pdfBuffer = Buffer.from(arrayBuffer);

  const parser = new PDFParse({ data: pdfBuffer });
  const result = await parser.getText();
  await parser.destroy(); 

  const lines = result.text.split('\n');

  const report: ReportData = {
    title: "Platts European Marketscan",
    sourceFile: filePath,
    commentary: [],
    mocData: []
  };

  let currentMode: 'TEXT' | 'MOC' = 'TEXT';
  let currentMoc: MocSection | null = null;
  let rawCommentaryLines: string[] = []; // Buffer for text before we stitch it

  const mocHeaderRegex = /(MOC TRADES ON CLOSE|MOC BIDS ON CLOSE|MOC OFFERS ON CLOSE|^Trades\b|^Bids\b|^Offers\b|^Withdrawals\b)/i;
  const commentaryHeaderRegex = /^(Platts.*?Daily Market Analysis|Platts.*?Rationale|Market Commentary|This assessment commentary applies)/i;

  for (let i = 0; i < lines.length; i++) {
    const cleanLine = lines[i].trim();
    if (!cleanLine) continue;

    // -- MOC DETECTION --
    if (mocHeaderRegex.test(cleanLine)) {
      currentMode = 'MOC';
      
      let type: MocSection["type"] = "Other";
      if (/TRADES/i.test(cleanLine)) type = "Trades";
      else if (/BIDS/i.test(cleanLine)) type = "Bids";
      else if (/OFFERS/i.test(cleanLine)) type = "Offers";
      else if (/WITHDRAWALS/i.test(cleanLine)) type = "Withdrawals";
      
      currentMoc = { type, heading: cleanLine, entries: [] };
      report.mocData.push(currentMoc);
      continue;
    }

    // -- MOC ACCUMULATION --
    if (currentMode === 'MOC') {
      if (commentaryHeaderRegex.test(cleanLine)) {
         currentMode = 'TEXT';
         rawCommentaryLines.push(cleanLine);
      } else {
         // Pass the raw line through our new extraction function
         currentMoc?.entries.push(extractMocDetails(cleanLine));
      }
      continue;
    }

    // -- STANDARD TEXT --
    if (currentMode === 'TEXT') {
       if (cleanLine.length > 4) {
           rawCommentaryLines.push(cleanLine);
       }
    }
  }

  // Post-process the commentary to fix broken PDF lines
  report.commentary = stitchCommentary(rawCommentaryLines);

  return report;
}

// 2. The Extraction Engine for MOC Lines
function extractMocDetails(rawText: string): ParsedMocEntry {
  const entry: ParsedMocEntry = { rawText };
  
  // Skip extracting "TQC" (Terms, Quality, Conditions) blocks to avoid false positives
  if (rawText.startsWith("TQC:") || rawText.startsWith("OPTOL:")) {
      return entry;
  }

  // Extract Company & Action (e.g., "VITOL BIDS", "REPSOL SELLS TO TOTAL")
  const actionMatch = rawText.match(/([A-Z0-9\s]+)\s+(BIDS|OFFERS|SELLS|BUYS|no longer bids|no longer offers)/i);
  if (actionMatch) {
    const precedingText = actionMatch[1].trim();
    const words = precedingText.split(/[:\s]+/);
    // Grab the last word before the action verb as the Company name
    entry.company = words[words.length - 1].replace(/[^A-Za-z0-9]/g, ''); 
    entry.action = actionMatch[2].toUpperCase();
  }

  // Extract Quantity (e.g., "FOR 27000.0MT", "FOR 100KB")
  const qtyMatch = rawText.match(/FOR\s+([\d\.]+[A-Z]+)/i);
  if (qtyMatch) {
    entry.quantity = qtyMatch[1];
  }

  // Extract Price (e.g., "$3.50", "$-2.5/mt")
  const priceMatch = rawText.match(/\$(-?[\d\.]+(:?\/[a-z]+)?)/i);
  if (priceMatch) {
    entry.price = priceMatch[0];
  }

  return entry;
}

// 3. The Stitching Engine for PDF Text
function stitchCommentary(lines: string[]): string[] {
  const stitched: string[] = [];
  let buffer = "";

  for (const line of lines) {
    if (!buffer) {
      buffer = line;
    } else {
      // If the buffer ends with a hyphen, it's a split word. Remove hyphen and combine.
      if (buffer.endsWith("-")) {
        buffer = buffer.slice(0, -1) + line;
      } 
      // If the buffer DOES NOT end with a period, colon, or question mark, 
      // it's likely a sentence broken across two lines. Combine them with a space.
      else if (!/[.:!?]$/.test(buffer)) {
        buffer += " " + line;
      } 
      // Otherwise, the sentence is finished. Push it and start a new buffer.
      else {
        stitched.push(buffer);
        buffer = line;
      }
    }
  }
  if (buffer) stitched.push(buffer);
  
  return stitched;
}

// Execute the parser
async function run() {
  const inputFilePath = path.join(import.meta.dir, "EUM_20260209.pdf"); 
  const outputFilePath = path.join(import.meta.dir, "output.json");
  
  try {
    console.log(`Refining text from ${inputFilePath}...`);
    const data = await parsePlattsPDF(inputFilePath);
    
    await Bun.write(outputFilePath, JSON.stringify(data, null, 2));
    
    console.log(`Successfully parsed & refined PDF.`);
    console.log(`JSON saved to ${outputFilePath}`);
  } catch (error) {
    console.error("Error parsing the PDF file.", error);
  }
}

run();