# Invoices

- **For** both partners, signed in, on a computer or phone.
- **Must** show every tracked invoice or payment installment once. A closed deal with no payments has one row. A recorded invoice date puts that row in Unpaid.

## List and totals

- [ ] On a computer, Owed to DoctorCRE, Awaiting invoice, Paid and the Outstanding age buckets share one summary strip. The table fills the rest of the screen and scrolls inside itself under its column names, and the page does not scroll. On a phone the totals share one row, All ages spans the next, and the four age buckets wrap into two columns above the table.
- [ ] Owed to DoctorCRE adds the recorded amounts on unpaid rows. It gives the unpaid count and says how many lack a recorded amount when the total is partial. If none have an amount, it says “No invoice amounts recorded yet” and gives the unpaid count.
- [ ] Awaiting invoice counts rows waiting for an invoice date. Paid counts rows with a recorded payment receipt. All, Unpaid, Awaiting invoice and Paid show their matching rows.
- [ ] Each row shows its deal and owner, the invoice date when known, the commission amount when known, and one status. Unpaid rows show days outstanding. Paid rows show days to payment.
- [ ] Search narrows by deal name. Owner filters the list and totals. The list heading counts visible rows. Clear filters restores the full list.
- [ ] Outstanding groups unpaid invoices by days since invoicing. Each bucket shows its age range, a count badge, the total of recorded amounts when present, and how many amounts are missing when a total is partial. Its full words, such as “2 invoices · 1 without a recorded amount”, are its spoken name and tooltip. A bucket filters the list to its age range. All ages clears that range. The active bucket, All ages included, has an accent border.
- [ ] Refresh reads the latest tracker and shows when it last updated. A failed refresh explains the problem and keeps the last available snapshot.

## Drawer

- [ ] Opening a row shows its commission amount when known, status, timeline and activity. Details shows the owner and dates when known. Empty values are left out.
- [ ] Open deal goes to the owning deal. Open Doc and Close invoice stay beside the title while the drawer scrolls. Closing returns focus to the row when it is still visible.
- [ ] Mark paid is available on an unpaid payment row. The partner picks a receipt date from the invoice date through today and saves. A confirmed receipt moves it to Paid. An unconfirmed save offers Retry payment for the same request.
