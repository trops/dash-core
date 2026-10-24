/**
 * The picker's empty option. Choosing it means "no pick for this widget",
 * which resolves to the type's default when there is one — so it names the
 * default even while another provider is picked (QA §4.6).
 */
export function emptyProviderOption({ defaultName, required }) {
  if (defaultName) return `— use default (${defaultName}) —`;
  return required ? "— select a provider —" : "— none —";
}
