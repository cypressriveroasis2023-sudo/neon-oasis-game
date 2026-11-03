import {approvedToolGroups,visibleApprovedTools} from './approvedCosNavigation';

/** Search only existing navigation labels; never search or resolve equipment records. */
export function matchingApprovedTools(
  query: string,
  trackerVisible: boolean,
  displayLabel: (workspace: string) => string,
): {label: string; items: string[]}[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return approvedToolGroups.flatMap(group => {
    // Apply the existing eligibility filter before searching, including blank searches.
    const items = visibleApprovedTools(group.items, trackerVisible).filter(workspace => {
      const label = `${group.label} ${workspace} ${displayLabel(workspace)}`.toLowerCase();
      return words.every(word => label.includes(word));
    });
    return items.length ? [{label: group.label, items}] : [];
  });
}
