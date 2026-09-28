"""Choosing a category for each transaction a bank shares, so budgets work from the start."""

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.finance.transactions import SORT_ORDERS
from app.models import Category, Transaction
from app.plaid.client import PlaidTransaction

# Plaid's personal finance categories (https://plaid.com/documents/pfc-taxonomy-all.csv) name
# each detailed category after its primary one, like FOOD_AND_DRINK_GROCERIES. These rules
# match the start of the detailed name, so they cover both versions of Plaid's taxonomy and
# categories Plaid adds later; the first match wins. Each points at one of the categories a
# household starts with (app/finance/categories.py), found by name among the household's own.
RULES: tuple[tuple[str, str], ...] = (
    ("INCOME_WAGES", "Paycheck"),
    ("INCOME_SALARY", "Paycheck"),
    ("INCOME_PAYROLL", "Paycheck"),
    ("INCOME_DIVIDENDS", "Interest & dividends"),
    ("INCOME_INTEREST", "Interest & dividends"),
    ("INCOME_", "Other income"),
    ("LOAN_PAYMENTS_CREDIT_CARD", "Credit card payments"),
    ("LOAN_PAYMENTS_MORTGAGE", "Rent & mortgage"),
    ("LOAN_PAYMENTS_", "Loan payments"),
    ("TRANSFER_OUT_WITHDRAWAL", "Cash & ATM"),
    ("TRANSFER_OUT_ATM", "Cash & ATM"),
    ("TRANSFER_IN_", "Transfers"),
    ("TRANSFER_OUT_", "Transfers"),
    ("BANK_FEES_", "Bank fees"),
    ("ENTERTAINMENT_", "Entertainment"),
    ("FOOD_AND_DRINK_GROCERIES", "Groceries"),
    ("FOOD_AND_DRINK_BEER_WINE", "Groceries"),
    ("FOOD_AND_DRINK_COFFEE", "Coffee"),
    ("FOOD_AND_DRINK_", "Restaurants"),
    ("GENERAL_MERCHANDISE_CLOTHING", "Clothing"),
    ("GENERAL_MERCHANDISE_ELECTRONICS", "Electronics"),
    ("GENERAL_MERCHANDISE_PET", "Pets"),
    ("GENERAL_MERCHANDISE_GIFTS", "Gifts & donations"),
    ("GENERAL_MERCHANDISE_FURNITURE", "Home goods"),
    ("GENERAL_MERCHANDISE_", "Shopping"),
    ("HOME_IMPROVEMENT_FURNITURE", "Home goods"),
    ("HOME_IMPROVEMENT_", "Home maintenance"),
    ("MEDICAL_PHARMAC", "Pharmacy"),
    ("MEDICAL_VETERINARY", "Pets"),
    ("MEDICAL_", "Medical"),
    ("PERSONAL_CARE_GYMS", "Fitness"),
    ("PERSONAL_CARE_", "Personal care"),
    ("GENERAL_SERVICES_INSURANCE", "Insurance"),
    ("GENERAL_SERVICES_AUTOMOTIVE", "Car maintenance"),
    ("GENERAL_SERVICES_CHILDCARE", "Kids"),
    ("GENERAL_SERVICES_EDUCATION", "Education"),
    ("GOVERNMENT_AND_NON_PROFIT_DONATIONS", "Gifts & donations"),
    ("GOVERNMENT_AND_NON_PROFIT_TAX", "Taxes"),
    ("TRANSPORTATION_GAS", "Gas & fuel"),
    ("TRANSPORTATION_PARKING", "Parking & tolls"),
    ("TRANSPORTATION_TOLLS", "Parking & tolls"),
    ("TRANSPORTATION_PUBLIC_TRANSIT", "Public transit"),
    ("TRANSPORTATION_TAXIS", "Rideshare & taxis"),
    ("TRAVEL_", "Travel"),
    ("RENT_AND_UTILITIES_RENT", "Rent & mortgage"),
    ("RENT_AND_UTILITIES_TELEPHONE", "Phone & internet"),
    ("RENT_AND_UTILITIES_INTERNET", "Phone & internet"),
    ("RENT_AND_UTILITIES_", "Utilities"),
)


def suggested_name(detailed: str) -> str | None:
    """The name of the starting category that fits one of Plaid's detailed categories."""
    for prefix, name in RULES:
        if detailed.startswith(prefix):
            return name
    return None


class CategoryChooser:
    """Picks categories for new transactions during one sync.

    A payee the household has categorized before gets that category again, so fixing one
    transaction's category teaches every later one. Otherwise Plaid's category decides, unless
    Plaid isn't confident about it.
    """

    def __init__(self, db: Session) -> None:
        self._by_name = {
            name.casefold(): category_id
            for category_id, name in db.execute(select(Category.id, Category.name))
        }
        self._by_payee: dict[str, uuid.UUID] = {}
        rows = db.execute(
            select(Transaction.payee, Transaction.category_id).order_by(*SORT_ORDERS["-date"])
        )
        for payee, category_id in rows:
            if category_id is not None:
                self._by_payee.setdefault(payee.casefold(), category_id)

    def choose(self, transaction: PlaidTransaction, payee: str) -> uuid.UUID | None:
        known = self._by_payee.get(payee.casefold())
        if known is not None:
            return known
        category = transaction.personal_finance_category
        if category is None or category.confidence_level == "LOW":
            return None
        name = suggested_name(category.detailed)
        return self._by_name.get(name.casefold()) if name else None
