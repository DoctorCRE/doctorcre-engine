# Invoices

- **For** both partners, signed in, on a computer or phone.
- **Must** show every tracked invoice or payment installment once. A closed deal with no payments has one row. A recorded invoice date puts that row in Unpaid.

## List and totals

- [ ] Owed to DoctorCRE adds the recorded amounts on unpaid rows. It gives the unpaid count and says how many lack a recorded amount when the total is partial. If none have an amount, it says “No invoice amounts recorded yet” and gives the unpaid count.
- [ ] Awaiting invoice counts rows waiting for an invoice date. Paid counts rows with a recorded payment receipt. All, Unpaid, Awaiting invoice and Paid show their matching rows.
- [ ] Each row shows its deal and owner, the invoice date when known, the commission amount or “Amount not recorded,” and one status. Unpaid rows show days outstanding. Paid rows show days to payment.
- [ ] Search narrows by deal name. Owner filters the list and totals. The list heading counts visible rows. Clear filters restores the full list.
- [ ] Outstanding groups unpaid invoices by days since invoicing. Each bucket shows its count, the total of recorded amounts when present, and how many amounts are missing when a total is partial. A bucket filters the list to its age range. All ages clears that range.
- [ ] Refresh reads the latest tracker and shows when it last updated. A failed refresh explains the problem and keeps the last available snapshot.

## Drawer

- [ ] Opening a row shows its commission amount or why it is missing, status, timeline and activity. Details shows the owner and dates, including “Due date not recorded” when the due date is missing.
- [ ] Open deal goes to the owning deal. Open Doc and Close invoice stay beside the title while the drawer scrolls. Closing returns focus to the row when it is still visible.
- [ ] Mark paid is available on an unpaid payment row. The partner picks a receipt date from the invoice date through today and saves. A confirmed receipt moves it to Paid. An unconfirmed save offers Retry payment for the same request.
