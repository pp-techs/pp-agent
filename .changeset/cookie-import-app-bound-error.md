---
"@workspace/desktop": patch
"@workspace/web": patch
---

Cookie import now tells you what it could not copy instead of reporting a plain "0 cookies": cookies that Chrome, Edge or Brave on Windows protect with app-bound encryption are counted and named as the reason, with a pointer to the new "From file…" button, and an import that copied nothing for that reason shows as an error. "From file…" imports a JSON cookie export (an array of cookies, as browser extensions write it). Google sign-in cookies tied to the source device (SIDCC, AEC, …) are left out, since they only log you out when copied. Import problems are noted in `cookie-import-diag.log` in the app's data folder.
