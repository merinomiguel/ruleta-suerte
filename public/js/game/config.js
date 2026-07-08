export const TOTAL_ROUNDS = 5;
export const JACKPOT_ROUND = TOTAL_ROUNDS - 1;
export const MAX_PLAYERS = 4;
export const TURN_SECONDS = 30;
// Orden visual desde las doce, siguiendo el sentido antihorario del programa.
export const WEDGES = [
  { type:"money", label:"100", value:100, color:"#46b9e8" },
  { type:"money", label:"200", value:200, color:"#8dcc32" },
  { type:"bankrupt", label:"QUIEBRA", color:"#111318" },
  { type:"x2", label:"X2", color:"#176c43" },
  { type:"money", label:"100", value:100, color:"#d94343" },
  { type:"money", label:"50", value:50, color:"#46b9e8" },
  { type:"money", label:"100", value:100, color:"#e4c728", dark:true },
  { type:"money", label:"100", value:100, color:"#7650a5" },
  { type:"lose", label:"PIERDE", color:"#f4f4ef", dark:true },
  { type:"money", label:"150", value:150, color:"#e67d2e" },
  { type:"money", label:"100", value:100, color:"#46b9e8" },
  { type:"money", label:"50", value:50, color:"#8dcc32" },
  { type:"money", label:"100", value:100, color:"#e4c728", dark:true },
  { type:"money", label:"200", value:200, color:"#7650a5" },
  { type:"half", label:"½", color:"#d94343" },
  { type:"money", label:"100", value:100, color:"#e67d2e" },
  { type:"money", label:"50", value:50, color:"#46b9e8" },
  { type:"money", label:"100", value:100, color:"#8dcc32" },
  { type:"money", label:"150", value:150, color:"#e4c728", dark:true },
  { type:"money", label:"100", value:100, color:"#7650a5" },
  { type:"wildcard", label:"COMODÍN", value:100, color:"#d9a514", dark:true },
  { type:"money", label:"100", value:100, color:"#e67d2e" },
  { type:"money", label:"50", value:50, color:"#46b9e8" },
  { type:"money", label:"150", value:150, color:"#8dcc32" }
];
export const LETTERS = "ABCDEFGHIJKLMNÑOPQRSTUVWXYZ".split("");
export const VOWELS = ["A","E","I","O","U"];
export const CONSONANTS = LETTERS.filter(l => !VOWELS.includes(l));
