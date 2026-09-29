// Leverage map — PURE curated data, client-safe, unit-tested.
//
// Leverage is a CAPACITY before it is an act. The board's other panels score
// what actors DO; this one records what each could threaten and what we hold
// over them, with a scale note and a source. It is labelled STRUCTURAL, NOT
// WARNING on every surface and is never coloured: a capacity that glows red
// every day is the Christmas-tree failure (docs/REVIEW-ECONOMY.md, "what not
// to do"). Refresh the figures quarterly; `asOf` says when they were last
// checked. Scales are relative bars (0-100) for the eye, the note carries the
// real number.

export interface LeverageItem {
  label: string;
  /** Relative bar, 0-100. */
  scale: number;
  /** The number behind the bar, with its unit. */
  note: string;
  source: string;
}

export interface LeverageEntry {
  asOf: string;                 // yyyy-mm
  threatens: LeverageItem[];    // what the actor can hold over the system / us
  weHold: LeverageItem[];       // what the U.S. / partners hold over the actor
}

export const LEVERAGE: Record<string, LeverageEntry> = {
  iran: {
    asOf: "2026-09",
    threatens: [
      { label: "Strait of Hormuz transit", scale: 100, note: "~20% of global oil consumption and ~20% of LNG trade pass the strait", source: "EIA, World Oil Transit Chokepoints" },
      { label: "Gulf energy infrastructure (proxies, drones)", scale: 70, note: "Abqaiq 2019 took ~5.7 Mb/d offline for days", source: "IEA Oil Market Report, Sep 2019" },
      { label: "Houthi Red Sea interdiction (proxy)", scale: 65, note: "Suez transits fell ~50% in early 2024", source: "IMF PortWatch" },
      { label: "Own crude exports as a lever", scale: 35, note: "~1.5–1.8 Mb/d, mostly to China", source: "Kpler / EIA estimates" },
    ],
    weHold: [
      { label: "Oil-export sanctions and secondary sanctions", scale: 80, note: "OFAC designations on shadow-fleet tankers and Chinese teapot refiners", source: "U.S. Treasury OFAC" },
      { label: "Dollar / SWIFT exclusion", scale: 75, note: "Major Iranian banks cut from SWIFT since 2012/2018", source: "SWIFT statements; EU regulation 267/2012" },
      { label: "Frozen assets", scale: 40, note: "Billions held under U.S./allied controls; releases are a bargaining chip", source: "U.S. Treasury; Congressional Research Service" },
    ],
  },
  russia: {
    asOf: "2026-09",
    threatens: [
      { label: "Pipeline gas to Europe (residual)", scale: 45, note: "EU imports of Russian pipeline gas fell from ~40% to well under 10% since 2021", source: "European Commission / Eurostat" },
      { label: "Overflight denial for Euro–Asia routing", scale: 60, note: "Siberian corridor closed to most Western carriers since 2022", source: "EASA / carrier notices" },
      { label: "Black Sea grain and Turkish Straits", scale: 50, note: "~30% of global wheat exports from the Black Sea before 2022", source: "FAO / UNCTAD" },
      { label: "Enriched-uranium and titanium supply", scale: 40, note: "Rosatom supplies roughly a quarter of U.S. reactor fuel needs (waivers through 2028)", source: "U.S. DOE; Congressional Research Service" },
    ],
    weHold: [
      { label: "Oil price cap and shadow-fleet designations", scale: 70, note: "G7 cap at $60/bbl; hundreds of tankers designated", source: "OFAC / OFSI / EU" },
      { label: "Immobilised central-bank reserves", scale: 75, note: "~€260bn immobilised, most at Euroclear", source: "European Commission" },
      { label: "Technology export controls", scale: 65, note: "BIS/EU controls on semiconductors, machine tools, aviation parts", source: "BIS / EU sanctions packages" },
    ],
  },
  china: {
    asOf: "2026-09",
    threatens: [
      { label: "Rare-earth and critical-mineral processing", scale: 95, note: "~90% of rare-earth refining, ~98% of gallium output; export licensing since 2023", source: "USGS Mineral Commodity Summaries; MOFCOM notices" },
      { label: "Taiwan Strait / South China Sea shipping", scale: 80, note: "~$2.5tn of trade transits the South China Sea annually", source: "CSIS ChinaPower" },
      { label: "Manufacturing dependence (pharma precursors, electronics)", scale: 70, note: "Majority share of many API and component supply chains", source: "U.S. Commerce supply-chain reviews" },
      { label: "Treasury holdings", scale: 25, note: "~$750bn, declining; a blunt and self-harming lever", source: "U.S. Treasury TIC data" },
    ],
    weHold: [
      { label: "Advanced-semiconductor export controls", scale: 85, note: "BIS rules on AI chips, EUV/DUV tools, foreign direct product rule", source: "BIS, Oct 2022 / 2023 / 2024 rules" },
      { label: "Tariffs (Section 301 / 232 / IEEPA)", scale: 70, note: "Broad tariff coverage on Chinese goods", source: "USTR / Federal Register" },
      { label: "Dollar clearing and secondary-sanction exposure of Chinese banks", scale: 55, note: "Exposure through Russia- and Iran-related designations", source: "OFAC" },
    ],
  },
  "north-korea": {
    asOf: "2026-09",
    threatens: [
      { label: "Cyber theft against financial systems", scale: 60, note: "$1.5bn Bybit theft (2025) was the largest crypto heist on record", source: "FBI / Chainalysis" },
      { label: "Munitions and labour exports to Russia", scale: 40, note: "Millions of artillery rounds and troops reported", source: "ROK NIS / open reporting" },
    ],
    weHold: [
      { label: "Comprehensive UN and unilateral sanctions", scale: 80, note: "UNSC resolutions 1718–2397; near-total trade ban", source: "UN Security Council" },
      { label: "Secondary sanctions on enablers", scale: 50, note: "Chinese and Russian intermediaries designated periodically", source: "OFAC" },
    ],
  },
  venezuela: {
    asOf: "2026-09",
    threatens: [
      { label: "Heavy crude supply to Gulf Coast refiners", scale: 35, note: "~0.8–0.9 Mb/d production; licence-dependent exports", source: "OPEC / EIA" },
      { label: "Migration pressure as leverage", scale: 45, note: "~7.7m Venezuelans abroad", source: "UNHCR R4V" },
    ],
    weHold: [
      { label: "PDVSA sanctions and licence regime", scale: 80, note: "General licences granted and withdrawn as leverage (GL 44 etc.)", source: "OFAC" },
      { label: "CITGO and frozen assets", scale: 55, note: "CITGO auction under Delaware court; gold at the Bank of England", source: "U.S. District Court (Del.); Bank of England litigation" },
    ],
  },
  turkey: {
    asOf: "2026-09",
    threatens: [
      { label: "Turkish Straits under Montreux", scale: 75, note: "Sole Black Sea entrance; Turkey has closed passage to warships since Feb 2022", source: "Montreux Convention; Turkish MFA" },
      { label: "Incirlik / Kürecik access", scale: 70, note: "Base access has been restricted or threatened repeatedly (2016, 2019)", source: "Open reporting; CRS" },
      { label: "Migration agreement with the EU", scale: 55, note: "~3.5m Syrians hosted under the 2016 EU–Turkey statement", source: "European Commission" },
    ],
    weHold: [
      { label: "CAATSA sanctions and F-35 exclusion", scale: 55, note: "SSB designated 2020; F-35 removal 2019", source: "U.S. State Department" },
      { label: "Financing and lira vulnerability", scale: 45, note: "High external financing need; IMF/US swap-line politics", source: "IMF Article IV" },
    ],
  },
  "saudi-arabia": {
    asOf: "2026-09",
    threatens: [
      { label: "OPEC+ spare capacity", scale: 90, note: "~3 Mb/d spare capacity, the market's swing barrel", source: "IEA Oil Market Report" },
      { label: "Petrodollar and Treasury recycling", scale: 40, note: "Yuan-settled crude trials; ~$130bn Treasuries", source: "U.S. Treasury TIC; open reporting" },
    ],
    weHold: [
      { label: "Security guarantees and arms supply", scale: 80, note: "Largest FMS customer", source: "DSCA" },
      { label: "Dollar clearing", scale: 60, note: "Riyal pegged to the dollar since 1986", source: "SAMA" },
    ],
  },
  egypt: {
    asOf: "2026-09",
    threatens: [
      { label: "Suez Canal access and overflight", scale: 80, note: "~12–15% of global trade in normal years; transit revenue ~$9bn", source: "Suez Canal Authority" },
    ],
    weHold: [
      { label: "Military aid and IMF programme", scale: 70, note: "$1.3bn/yr FMF; $8bn IMF EFF (2024)", source: "U.S. State Department; IMF" },
    ],
  },
  houthis: {
    asOf: "2026-09",
    threatens: [
      { label: "Bab-el-Mandeb / Red Sea shipping", scale: 90, note: "Suez transits halved in 2024; Cape rerouting adds ~10–14 days", source: "IMF PortWatch; UNCTAD" },
      { label: "Undersea cables in the Red Sea", scale: 40, note: "~17% of global internet traffic transits Red Sea cables", source: "TeleGeography" },
    ],
    weHold: [
      { label: "FTO / SDGT designations and interdiction of Iranian supply", scale: 50, note: "Redesignated FTO in 2025; maritime interdictions of components", source: "U.S. State Department; CENTCOM releases" },
    ],
  },
};

export function leverageFor(actorId: string): LeverageEntry | null {
  return LEVERAGE[actorId] ?? null;
}
