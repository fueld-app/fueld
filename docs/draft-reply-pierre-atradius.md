Subject: Re: Fueld & Atradius insurance cover column
In-Reply-To: <9d53858d-7a2f-611b-3e45-2d80c301c808@fueld.app>

Hi Pierre,

A short update following my earlier note, now that the first upload is worth
trying.

Two things have changed, both in the mapping step:

- The client picker on each row is now a search box rather than a plain dropdown —
  type a few letters of the name and it finds them. With 141 buyers to map in your
  file, working down a dropdown would have been painful.
- Where the system thinks it recognises a buyer, it offers a "name suggests …"
  link under that row. Click it to accept. It is never applied on its own: those
  name guesses are the ones most likely to be wrong, and a wrong one would put one
  client's cover against another.

Everything else stands as described — the mapping is remembered by Atradius buyer
number, so you do it once and later uploads match by themselves.

One correction to my earlier note: I said a buyer showing €0 had their limit
refused or cancelled. That was too narrow. Some rows I had been treating as
inactive — a cancellation dated in the future, or a cover that has not been
increased — are in fact still in force, and now show their real figure rather than
€0. If a number looks wrong, tell me and I will check it against your file.

Also worth knowing: until a buyer is mapped, that client's cover reads "not mapped"
rather than a figure, and the page header states how many buyers are mapped
("N of 158 — figures cover mapped clients only"). So please read the column as
partial on the first pass. It will not pretend to be complete, but the total will
be low until the mapping is done.

Give the first upload a go and tell me if anything reads oddly — the mapping step
especially, since that is the one part that is yours to do.

Best,
Patrick
