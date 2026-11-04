/** Descriptive provenance only. Product IDs, source hashes, freshness and
 * endpoint ownership are validated independently; a label never grants trust.
 * Retain actual API provenance rather than inventing a CSV filename. */
export function isTrackerSourceLabel(value:unknown):value is string {
 if(typeof value!=="string"||value!==value.trim())return false;
 if(/^ServiceItem_List_[0-9]{14}\.csv$/.test(value))return true;
 const m=/^MHelpDesk pull accepted (20[0-9]{2})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):([0-5][0-9]) CT$/.exec(value);
 if(!m)return false;
 const d=new Date(Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3])));
 return d.getUTCFullYear()===Number(m[1])&&d.getUTCMonth()===Number(m[2])-1&&d.getUTCDate()===Number(m[3]);
}
