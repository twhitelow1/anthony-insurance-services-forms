import { Caveat, Dancing_Script, Great_Vibes } from "next/font/google";

// Script fonts for typed signatures (like DocuSign's "Select style").
const dancing = Dancing_Script({ subsets: ["latin"], weight: "600", display: "swap" });
const vibes = Great_Vibes({ subsets: ["latin"], weight: "400", display: "swap" });
const caveat = Caveat({ subsets: ["latin"], weight: "600", display: "swap" });

export const SIGNATURE_FONTS = [
  { id: "dancing", label: "Style 1", family: dancing.style.fontFamily },
  { id: "vibes", label: "Style 2", family: vibes.style.fontFamily },
  { id: "caveat", label: "Style 3", family: caveat.style.fontFamily },
] as const;
