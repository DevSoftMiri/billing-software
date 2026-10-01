import axios from 'axios'

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000/api' })

api.interceptors.request.use((config) => {
    const token = localStorage.getItem('ledgerly_token')
    if (token) config.headers.Authorization = `Bearer ${token}`
    return config
})

export const authApi = {
    login: (payload) => api.post('/auth/login', payload),
    register: (payload) => api.post('/auth/register', payload),
}

export const dataApi = {
    products: () => api.get('/products'),
    createProduct: (payload) => api.post('/products', payload),
    updateProduct: (id, payload) => api.put(`/products/${id}`, payload),
    deleteProduct: (id) => api.delete(`/products/${id}`),
    invoices: () => api.get('/invoices'),
    createInvoice: (payload) => api.post('/invoices', payload),
    updateInvoicePayment: (id, payload) => api.patch(`/invoices/${id}/payment`, payload),
    invoicePdf: (id) => api.get(`/invoices/${id}/pdf`, { responseType: 'blob' }),
    deleteInvoice: (id) => api.delete(`/invoices/${id}`),
    customers: (search = '') => api.get('/customers', { params: search ? { search } : {} }),
    createCustomer: (payload) => api.post('/customers', payload),
    lookupPinCode: (pinCode) => api.get(`/location/pincode/${pinCode}`),
    settings: () => api.get('/settings'),
    updateSettings: (payload) => api.put('/settings', payload),
}

export default api
