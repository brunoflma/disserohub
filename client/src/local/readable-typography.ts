/** Enlarge the existing UI type hierarchy, including small labels in nested media rules. */
export function installReadableTypography(): void {
  const visit = (rules: CSSRuleList): void => {
    for (const rule of Array.from(rules)) {
      if ('selectorText' in rule && 'style' in rule) {
        const r = rule as CSSStyleRule;
        if (!/\.ui-/.test(r.selectorText)) continue;
        const direct = r.style.getPropertyValue('font-size');
        // Shorthands containing var() leave font-size unresolved in CSSOM.
        const size = /^\d+(?:\.\d+)?px$/.test(direct) ? direct : /(?:^|\s)(\d+(?:\.\d+)?px)(?=\/|\s)/.exec(r.style.getPropertyValue('font'))?.[1];
        if (size) {
          r.style.setProperty('font-size', `max(14px, calc(${size} * var(--ui-type-scale, 1.15)))`, r.style.getPropertyPriority('font-size'));
        }
      } else if ('cssRules' in rule) visit((rule as CSSGroupingRule).cssRules);
    }
  };
  for (const sheet of Array.from(document.styleSheets ?? [])) {
    try { visit(sheet.cssRules); } catch { /* External stylesheets do not belong to this local UI. */ }
  }
}
