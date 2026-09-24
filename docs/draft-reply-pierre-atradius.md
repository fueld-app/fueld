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
buyers" list. Each row has a search box: type a few letters of the client name and
it finds them, so you do not have to scroll a long list. Where the system thinks it
recognises a buyer it shows a "name suggests …" link under the row — click it to
accept, or search for the right client instead. A suggestion is never applied on
its own, because these name guesses are exactly the ones that can be wrong, and a
wrong one would put one client's cover against another.

**That mapping is remembered by Atradius buyer number, which is stable**, so you do
it once and future monthly uploads match by themselves — you should not need to
revisit it.

Until a buyer is mapped, that client's cover shows as "not mapped" rather than a
figure — so please read the column as partial until the mapping is done, and the
page header states how many buyers are mapped ("N of 158 — figures cover mapped
clients only"). It never presents a partial picture as if it were complete, but
the total will be low on the first pass for that reason.

**On the API**

Worth asking Atradius whether they offer one, but I would not hold the current
workflow up for it. The monthly file is already a one-click upload, and an API
would mainly remove that click — it would not remove the mapping step, which is
about buyer identity rather than file transfer. If they do offer one, we can
revisit; it would be a straightforward swap on our side since the import is
already a single entry point.

Please give the first upload a go and tell me if anything reads oddly — the
mapping step in particular, since that is the one part that is yours to do. If
working through the list feels slow at 150-odd buyers, tell me and I will look at
making it faster.

Best,
Patrick
