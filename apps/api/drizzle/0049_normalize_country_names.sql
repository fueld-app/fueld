-- Normalize country display names in counterparties table to use common short names.
-- This matches the updated frontend COUNTRIES list and makes countries easier to find.
-- Only the `country` column (display name) is updated; ISO codes are unchanged.

UPDATE "counterparties" SET "country" = 'Armenia' WHERE "country" = 'Republic of Armenia';--> statement-breakpoint
UPDATE "counterparties" SET "country" = 'Azerbaijan' WHERE "country" = 'Republic of Azerbaijan';--> statement-breakpoint
UPDATE "counterparties" SET "country" = 'Bahrain' WHERE "country" = 'Kingdom of Bahrain';--> statement-breakpoint
UPDATE "counterparties" SET "country" = 'Benin' WHERE "country" = 'Republic of Benin';--> statement-breakpoint
UPDATE "counterparties" SET "country" = 'Bosnia & Herzegovina' WHERE "country" = 'Bosnia Hercegovina';--> statement-breakpoint
UPDATE "counterparties" SET "country" = 'Brunei' WHERE "country" = 'Brunei Darussalam';--> statement-breakpoint
UPDATE "counterparties" SET "country" = 'Cape Verde' WHERE "country" = 'Republic of Cape Verde';--> statement-breakpoint
UPDATE "counterparties" SET "country" = 'China' WHERE "country" = 'People''s Republic of China';--> statement-breakpoint
UPDATE "counterparties" SET "country" = 'Congo' WHERE "country" = 'The Congo';--> statement-breakpoint
UPDATE "counterparties" SET "country" = 'Congo (DRC)' WHERE "country" = 'Democratic Republic of Congo';--> statement-breakpoint
UPDATE "counterparties" SET "country" = 'Croatia' WHERE "country" = 'Republic of Croatia';--> statement-breakpoint
UPDATE "counterparties" SET "country" = 'Djibouti' WHERE "country" = 'Republic of Djibouti';--> statement-breakpoint
UPDATE "counterparties" SET "country" = 'Eswatini' WHERE "country" = 'Kingdom of Eswatini';--> statement-breakpoint
UPDATE "counterparties" SET "country" = 'Estonia' WHERE "country" = 'Republic of Estonia';--> statement-breakpoint
UPDATE "counterparties" SET "country" = 'Gambia' WHERE "country" = 'The Gambia';--> statement-breakpoint
UPDATE "counterparties" SET "country" = 'Georgia' WHERE "country" = 'Republic of Georgia';--> statement-breakpoint
UPDATE "counterparties" SET "country" = 'Hong Kong' WHERE "country" = 'Hong Kong, S.A.R., China';--> statement-breakpoint
UPDATE "counterparties" SET "country" = 'Hong Kong' WHERE "country" = 'Hong Kong (S.A.R., China)';--> statement-breakpoint
UPDATE "counterparties" SET "country" = 'Ireland' WHERE "country" = 'Republic of Ireland';--> statement-breakpoint
UPDATE "counterparties" SET "country" = 'Kazakhstan' WHERE "country" = 'Republic of Kazakhstan';--> statement-breakpoint
UPDATE "counterparties" SET "country" = 'Kyrgyzstan' WHERE "country" = 'Republic of Kyrgyzstan';--> statement-breakpoint
UPDATE "counterparties" SET "country" = 'Latvia' WHERE "country" = 'Republic of Latvia';--> statement-breakpoint
UPDATE "counterparties" SET "country" = 'Libya' WHERE "country" = 'State of Libya';--> statement-breakpoint
UPDATE "counterparties" SET "country" = 'Lithuania' WHERE "country" = 'Republic of Lithuania';--> statement-breakpoint
UPDATE "counterparties" SET "country" = 'Macau' WHERE "country" = 'Macau, S.A.R., China';--> statement-breakpoint
UPDATE "counterparties" SET "country" = 'Macau' WHERE "country" = 'Macau (S.A.R., China)';--> statement-breakpoint
UPDATE "counterparties" SET "country" = 'Maldives' WHERE "country" = 'Republic of Maldives';--> statement-breakpoint
UPDATE "counterparties" SET "country" = 'Micronesia' WHERE "country" = 'Federated States of Micronesia';--> statement-breakpoint
UPDATE "counterparties" SET "country" = 'Moldova' WHERE "country" = 'Republic of Moldova';--> statement-breakpoint
UPDATE "counterparties" SET "country" = 'Myanmar' WHERE "country" = 'Union of Myanmar';--> statement-breakpoint
UPDATE "counterparties" SET "country" = 'Namibia' WHERE "country" = 'Republic of Namibia';--> statement-breakpoint
UPDATE "counterparties" SET "country" = 'Niger' WHERE "country" = 'Republic of the Niger';--> statement-breakpoint
UPDATE "counterparties" SET "country" = 'North Korea' WHERE "country" = 'Democratic People''s Republic of Korea';--> statement-breakpoint
UPDATE "counterparties" SET "country" = 'North Macedonia' WHERE "country" = 'Republic of North Macedonia';--> statement-breakpoint
UPDATE "counterparties" SET "country" = 'Oman' WHERE "country" = 'Sultanate of Oman';--> statement-breakpoint
UPDATE "counterparties" SET "country" = 'Palau' WHERE "country" = 'Republic of Palau';--> statement-breakpoint
UPDATE "counterparties" SET "country" = 'Palestine' WHERE "country" = 'The State of Palestine';--> statement-breakpoint
UPDATE "counterparties" SET "country" = 'Qatar' WHERE "country" = 'State of Qatar';--> statement-breakpoint
UPDATE "counterparties" SET "country" = 'Russia' WHERE "country" = 'Russian Federation';--> statement-breakpoint
UPDATE "counterparties" SET "country" = 'Samoa' WHERE "country" = 'Independent State of Samoa';--> statement-breakpoint
UPDATE "counterparties" SET "country" = 'Singapore' WHERE "country" = 'Republic of Singapore';--> statement-breakpoint
UPDATE "counterparties" SET "country" = 'Slovenia' WHERE "country" = 'Republic of Slovenia';--> statement-breakpoint
UPDATE "counterparties" SET "country" = 'Somalia' WHERE "country" = 'Somali Democratic Republic';--> statement-breakpoint
UPDATE "counterparties" SET "country" = 'South Korea' WHERE "country" = 'Republic of Korea';--> statement-breakpoint
UPDATE "counterparties" SET "country" = 'Tajikistan' WHERE "country" = 'Republic of Tajikistan';--> statement-breakpoint
UPDATE "counterparties" SET "country" = 'Taiwan' WHERE "country" = 'Taiwan, China';--> statement-breakpoint
UPDATE "counterparties" SET "country" = 'Turkmenistan' WHERE "country" = 'Republic of Turkmenistan';--> statement-breakpoint
UPDATE "counterparties" SET "country" = 'Yemen' WHERE "country" = 'Yemeni Republic';--> statement-breakpoint
UPDATE "counterparties" SET "country" = 'Zaire' WHERE "country" = 'Republic of Zaire';
