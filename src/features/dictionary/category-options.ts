type CategoryOption = { slug: string; name: string; parent_slug: string | null; level: number | null };

// Level-2 categories as "Level 1 / Level 2" (fetchCategories already leaves deprecated ones out).
export function subcategoryOptions(rows: CategoryOption[]): { value: string; label: string }[] {
  return rows
    .filter((p) => p.level === 1)
    .flatMap((p) => rows.filter((c) => c.parent_slug === p.slug).map((c) => ({ value: c.slug, label: `${p.name} / ${c.name}` })));
}
