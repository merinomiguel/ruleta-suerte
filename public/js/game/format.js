export function normalize(text) {
  return text.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-ZÑ0-9]/g, "");
}

export function money(value) {
  return `${Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")} €`;
}
