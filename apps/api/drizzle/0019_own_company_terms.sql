ALTER TABLE "counterparties"
ADD COLUMN IF NOT EXISTS "customer_terms" text;

ALTER TABLE "counterparties"
ADD COLUMN IF NOT EXISTS "supplier_terms" text;

-- Initialize defaults for existing own companies
UPDATE "counterparties"
SET "customer_terms" = $$This Confirmation is made subject to ${companyName}’s General Terms and Conditions of Sale effective February 2026 (“ GTCs”), available at www.rivieramarine.mc,
which together with this Confirmation constitute the entire agreement between the parties. In the event of conflict, this Confirmation shall prevail, except in respect of Title
and Retention of Title, Payment, Credit & Security, Sanctions & Compliance, Limitation of Liability and Law & Arbitration, which may only be amended by written agreement
signed by Seller. Any terms or conditions submitted by Buyer are expressly rejected.
Delivery procedures, sampling and operational formalities may be carried out in accordance with the Physical Supplier’s standard procedures; however, as between Seller
and Buyer, the GTCs shall prevail in case of inconsistency.
Buyer is requested to confirm acceptance. Absent written objection prior to delivery, performance of the Contract shall constitute full acceptance of these Terms.$$
WHERE "is_own_company" = true AND "customer_terms" IS NULL;

UPDATE "counterparties"
SET "supplier_terms" = $$Supplier warrants and represents that:
1. The Products are not of sanctioned origin and neither Supplier, its affiliates, directors, officers, employees nor ultimate beneficial owners are subject to sanctions
imposed by the United Nations, European Union, United Kingdom, United States or Singapore.
2. Supplier is and shall remain in full compliance with all applicable trade sanctions, export controls and related laws (“Sanctions Laws”).
If, in ${companyName}’s reasonable opinion, any of the above warranties are inaccurate, or if payment under this contract may be delayed, blocked or exposed to
regulatory risk, ${companyName} shall be entitled , without liability , to suspend performance , terminate the contract , change the currency of payment , or
implement any alternative lawful payment mechanism at its sole discretion.
Supplier further warrants that:
• The supply complies with MARPOL Annex VI and applicable MEPC guidelines;
• The supply complies with SOLAS requirements, including provision of a valid MSDS prior to delivery;
• The MARPOL sample shall be drawn at the receiving vessel’s manifold by continuous drip sampler;
• The Products shall be stable, homogeneous and free from waste oils or harmful contaminants.
Quantities ordered are maximum quantities. ${companyName} shall not be responsible for payment of quantities supplied in excess of those nominated unless
expressly agreed in writing.
Signed and stamped Bunker Delivery Receipts must be provided with the invoice. ${companyName} reserves the right to withhold payment pending receipt of
proper delivery documentation.$$
WHERE "is_own_company" = true AND "supplier_terms" IS NULL;
