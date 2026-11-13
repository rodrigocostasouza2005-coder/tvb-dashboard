"use client";

// Único pedaço de interatividade client desta tela de exclusão em massa — tudo o resto (seleção
// individual, submit, confirmação) é HTML puro (checkbox + form action), de propósito, pra ficar
// consistente com o resto desta página (nenhum outro componente aqui usa estado client).
export function SelectAllCheckbox({ formId, name }: { formId: string; name: string }) {
  function toggleAll(checked: boolean) {
    // Os checkboxes das linhas ficam DENTRO da <table>, fora do <form> (associados só pelo
    // atributo form="..." pra o form poder envolver a seção inteira sem quebrar o layout da
    // tabela) — por isso a busca é em todo o documento, não escopada ao elemento <form>.
    const inputs = document.querySelectorAll<HTMLInputElement>(`input[form="${formId}"][name="${name}"]`);
    for (const input of inputs) input.checked = checked;
  }
  return (
    <input
      type="checkbox"
      aria-label="Selecionar todos os prospectos desta página"
      onChange={(e) => toggleAll(e.currentTarget.checked)}
      className="h-3.5 w-3.5"
    />
  );
}
