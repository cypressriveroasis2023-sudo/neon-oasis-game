/** Presentation only. Never changes a saved observation, lifecycle or placement. */
export const sniperShopDisplay=(placement:string,label:string)=>placement.toLowerCase()==='shop'&&/\bSNIPER\b|\bCAM[\s-]*V\b/i.test(label);
