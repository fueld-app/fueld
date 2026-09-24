Subject: Re: Fueld & Atradius insurance cover column

Hi Pierre,

Thanks for the detail, and for the sample file — that made this straightforward.
The column is now live on your Customer Credit page, and the monthly upload works.

**How it works**

You upload the Atradius export as you already export it (the file you sent works
unchanged). Each upload **replaces** the previous one, exactly as you suggested —
we keep the previous import only as an audit record. Columns F (buyer) and AE
(amount) are read automatically, by header name rather than position, so a column
reordering by Atradius will not silently break it.

The new "Atradius Cover" column sits next to the management credit limit and shows
the insured amount per client. As you said, those are two different things and how
they sit together is your call for now — we show both, side by side, without
reconciling them.

**One thing you should know: the first upload needs a mapping step**

Your file names buyers as Atradius names them, and those often differ from how the
same company is spelled in Fueld. For example:

    Atradius:  GEFO GESELLSCHAFT FÜROELTRANSPORTE MBH
    Fueld:     GEFO Gesellschaft fur Oeltransporte mbH

    Atradius:  ADI SERVIZI MARITTIMI S.R.L.
    Fueld:     AdI Servizi Marittimi S.r.l.in A.S.

So on the first upload some buyers will be matched automatically (by exact name —
17 of your 158 in the file you sent) and the rest appear in a "map unmatched
buyers" list where you pick the Fueld client for each. **That mapping is remembered
by Atradius buyer number, which is stable**, so you do it once and future monthly
uploads match by themselves — you should not need to revisit it.

Until a buyer is mapped, that client's cover shows as "not mapped" rather than a
figure, and the page states how many buyers are mapped ("N of 158 — figures cover
mapped clients only"). So the column never silently presents a partial picture as
if it were complete.

**On the API**

Worth asking Atradius whether they offer one, but I would not hold the current
workflow up for it. The monthly file is already a one-click upload, and an API
would mainly remove that click — it would not remove the mapping step, which is
about buyer identity rather than file transfer. If they do offer one, we can
revisit; it would be a straightforward swap on our side since the import is
already a single entry point.

Please give the first upload a go and tell me if anything reads oddly. In
particular I would be interested whether the "not mapped" list is manageable —
if it is a long list, we can make that step quicker.

Best,
Patrick
