"""
One-time import of the existing Quote_Data_MKT.xlsx into the new DB.
Run with: python seed_from_excel.py /path/to/Quote_Data_MKT.xlsx
"""
import sys
import pandas as pd

sys.path.insert(0, ".")
from app.database import SessionLocal, engine, Base
from app.models.db_models import Quote, PurchaseOrder, AccountRegistration, QuoteStatus

STATUS_MAP = {
    "Fullfilled": QuoteStatus.fulfilled,
    "Fulfilled": QuoteStatus.fulfilled,
    "Stalled": QuoteStatus.stalled,
    "In Progress": QuoteStatus.in_progress,
}


def main(xlsx_path: str):
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()

    sheets = pd.read_excel(xlsx_path, sheet_name=None, header=0)

    quotes_df = sheets["Quotation"]
    for _, row in quotes_df.iterrows():
        if pd.isna(row.get("Business Name")):
            continue
        date_val = row.get("Date of Quote Requested")
        q = Quote(
            business_name=str(row["Business Name"]),
            requested_by=str(row.get("Quote Requested by")) if pd.notna(row.get("Quote Requested by")) else None,
            quote_value=float(row.get("Quote Value") or 0),
            product_brand=str(row.get("Quoted Product Brand")) if pd.notna(row.get("Quoted Product Brand")) else None,
            date_requested=pd.to_datetime(date_val) if pd.notna(date_val) else None,
            status=STATUS_MAP.get(str(row.get("Status")).strip(), QuoteStatus.in_progress),
        )
        db.add(q)

    po_df = sheets["PO"]
    for _, row in po_df.iterrows():
        if pd.isna(row.get("Business Name")):
            continue
        date_val = row.get("Date of PO")
        po = PurchaseOrder(
            business_name=str(row["Business Name"]),
            po_value=float(row.get("PO Value") or 0),
            date_of_po=pd.to_datetime(date_val) if pd.notna(date_val) else None,
        )
        db.add(po)

    acct_df = sheets["Account Registration"]
    for _, row in acct_df.iterrows():
        if pd.isna(row.get("Business Name")):
            continue
        reg_date = row.get("Registration Date")
        acct = AccountRegistration(
            business_name=str(row["Business Name"]),
            account_number=str(row.get("Account Number")) if pd.notna(row.get("Account Number")) else None,
            registration_date=pd.to_datetime(reg_date) if pd.notna(reg_date) else None,
            status=str(row.get("Status")) if pd.notna(row.get("Status")) else None,
        )
        db.add(acct)

    db.commit()
    n_quotes = db.query(Quote).count()
    n_pos = db.query(PurchaseOrder).count()
    n_accts = db.query(AccountRegistration).count()
    print(f"Imported: {n_quotes} quotes, {n_pos} POs, {n_accts} account registrations")
    db.close()


if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else "Quote_Data_MKT.xlsx"
    main(path)
