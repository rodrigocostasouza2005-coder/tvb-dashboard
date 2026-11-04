/** Valida formato e dígitos verificadores do CNPJ numérico ou alfanumérico. Não consulta situação cadastral. */
export function validarCnpj(input: string): string | null {
  const cnpj = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^[A-Z0-9]{12}[0-9]{2}$/.test(cnpj) || cnpj.split("").every((char) => char === cnpj[0])) return null;
  const valor = (char: string) => char.charCodeAt(0) - 48;
  const calcular = (base: string, pesos: number[]) => {
    const soma = [...base].reduce((total, char, i) => total + valor(char) * pesos[i], 0);
    const resto = soma % 11;
    return String(resto < 2 ? 0 : 11 - resto);
  };
  const digito1 = calcular(cnpj.slice(0, 12), [5,4,3,2,9,8,7,6,5,4,3,2]);
  const digito2 = calcular(cnpj.slice(0, 12) + digito1, [6,5,4,3,2,9,8,7,6,5,4,3,2]);
  return cnpj.slice(-2) === digito1 + digito2 ? cnpj : null;
}
