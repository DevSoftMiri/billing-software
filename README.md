# Ledgerly Billing

Separate MERN billing workspace for a small Indian business.

## Run locally

1. Copy `backend/.env.example` to `backend/.env` and set `MONGO_URI` and `JWT_SECRET`.
2. Copy `frontend/.env.example` to `frontend/.env` if the API is not on the default port.
3. Start MongoDB, then run `npm run dev` inside `backend`.
4. In another terminal, run `npm run dev` inside `frontend` and open the printed Vite URL.

The frontend currently includes a polished working workspace with local interactive product and invoice flows. The backend exposes JWT auth, product/customer CRUD, invoice creation with atomic invoice sequencing, settings, paginated invoice search, and PDF download endpoints.
