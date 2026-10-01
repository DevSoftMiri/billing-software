import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, CheckCircle2, Download, Eye, FileText, Plus, Printer, Search, Share2, Trash2 } from 'lucide-react'
import { dataApi } from '../services/api'

const money = (value) => `Rs.${Number(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const mobileDigits = (value = '') => String(value).replace(/\D/g, '').slice(-10)
const isTenDigitMobile = (value) => /^\d{10}$/.test(mobileDigits(value))
const numericText = (value = '') => String(value).replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1')
const wholeNumberText = (value = '') => String(value).replace(/\D/g, '')
const clampPercent = (value) => Math.min(100, Math.max(0, Number(value) || 0))
const normalizeState = (value = '') => String(value).trim().toLowerCase()
const emptyAddress = { line1: '', city: '', state: '', pinCode: '' }
const splitAddress = (address = '', state = '') => {
    const parts = String(address || '').split(',').map((part) => part.trim()).filter(Boolean)
    const pinMatch = String(address || '').match(/\b\d{6}\b/)
    return { line1: parts[0] || '', city: parts[1] || '', state: state || parts[2] || '', pinCode: pinMatch?.[0] || '' }
}
const formatAddress = (address) => [address.line1, address.city, address.state, address.pinCode].filter(Boolean).join(', ')
const steps = ['Customer', 'Products', 'Review', 'Save']

export default function CreateBillDirect({ products, setProducts, setInvoices, notify }) {
    const [step, setStep] = useState(0)
    const [customer, setCustomer] = useState('')
    const [mobile, setMobile] = useState('')
    const [billingAddress, setBillingAddress] = useState(emptyAddress)
    const [shippingAddress, setShippingAddress] = useState(emptyAddress)
    const [shippingSameAsBilling, setShippingSameAsBilling] = useState(true)
    const [items, setItems] = useState([])
    const [draft, setDraft] = useState({ name: '', price: '', gst: 18, quantity: 1, unit: 'Piece' })
    const [discount, setDiscount] = useState(0)
    const [paymentStatus, setPaymentStatus] = useState('Paid')
    const [amountReceived, setAmountReceived] = useState(0)
    const [businessState, setBusinessState] = useState('Maharashtra')
    const [saving, setSaving] = useState(false)
    const [savedInvoice, setSavedInvoice] = useState(null)
    const [matchedCustomer, setMatchedCustomer] = useState(null)
    const [customerSuggestions, setCustomerSuggestions] = useState([])
    const [customerLookupActive, setCustomerLookupActive] = useState(false)
    const [productLookupActive, setProductLookupActive] = useState(false)
    const suggestions = productLookupActive ? products.filter((product) => draft.name && product.name.toLowerCase().includes(draft.name.toLowerCase())).slice(0, 5) : []
    const customerState = billingAddress.state || matchedCustomer?.state || ''
    const taxMode = normalizeState(customerState) && normalizeState(customerState) !== normalizeState(businessState) ? 'igst' : 'split'
    const totals = useMemo(() => {
        const discountPercent = clampPercent(discount)
        const subtotal = items.reduce((sum, item) => sum + Number(item.price) * Number(item.quantity), 0)
        const discountAmount = subtotal * discountPercent / 100
        const taxable = subtotal - discountAmount
        const gst = items.reduce((sum, item) => sum + Number(item.price) * Number(item.quantity) * (1 - discountPercent / 100) * Number(item.gst) / 100, 0)
        return { subtotal, discountAmount, taxable, gst, total: taxable + gst }
    }, [items, discount])
    useEffect(() => {
        dataApi.settings()
            .then((response) => setBusinessState(response.data?.state || 'Maharashtra'))
            .catch(() => setBusinessState('Maharashtra'))
    }, [])
    useEffect(() => {
        if (!customerLookupActive) return undefined
        const query = mobile.trim() || customer.trim()
        if (query.length < 2) {
            return undefined
        }

        const timeout = window.setTimeout(() => {
            dataApi.customers(query)
                .then((response) => {
                    const customers = response.data || []
                    const exactMobileMatch = customers.find((savedCustomer) => mobileDigits(savedCustomer.mobile) === mobileDigits(mobile) && isTenDigitMobile(mobile))
                    if (exactMobileMatch) {
                        setMatchedCustomer(exactMobileMatch)
                        setCustomer(exactMobileMatch.name || '')
                        setCustomerSuggestions([])
                        setCustomerLookupActive(false)
                        return
                    }
                    setCustomerSuggestions(customers.slice(0, 5))
                })
                .catch(() => setCustomerSuggestions([]))
        }, 250)

        return () => window.clearTimeout(timeout)
    }, [customer, customerLookupActive, mobile])
    const chooseProduct = (product) => {
        setDraft({ name: product.name, price: product.price, gst: product.gst, quantity: 1, unit: product.unit || 'Piece', productId: product.id, code: product.code })
        setProductLookupActive(false)
    }
    const chooseCustomer = (selectedCustomer) => {
        const savedAddress = splitAddress(selectedCustomer.address, selectedCustomer.state)
        setMobile(selectedCustomer.mobile || '')
        setCustomer(selectedCustomer.name || '')
        setBillingAddress(savedAddress)
        if (shippingSameAsBilling) setShippingAddress(savedAddress)
        setMatchedCustomer(selectedCustomer)
        setCustomerSuggestions([])
        setCustomerLookupActive(false)
    }
    const updateMobile = (value) => {
        const nextMobile = value.replace(/\D/g, '').slice(0, 10)
        setMobile(nextMobile)
        setMatchedCustomer(null)
        setCustomerLookupActive(true)
        if ((nextMobile.trim() || customer.trim()).length < 2) setCustomerSuggestions([])
    }
    const updateCustomer = (value) => {
        setCustomer(value)
        setMatchedCustomer(null)
        setCustomerLookupActive(true)
        if ((mobile.trim() || value.trim()).length < 2) setCustomerSuggestions([])
    }
    const addLine = () => {
        if (!draft.name.trim() || Number(draft.price) <= 0) return notify('Enter a product name and positive price')
        const nextLine = { ...draft, price: Number(draft.price), quantity: Number(draft.quantity) || 1 }
        setItems([...items, nextLine])
        if (draft.productId) {
            setProducts((current) => current.map((product) => product.id === draft.productId ? { ...product, name: draft.name, price: Number(draft.price), gst: Number(draft.gst), unit: draft.unit } : product))
        }
        setDraft({ name: '', price: '', gst: 18, quantity: 1, unit: 'Piece' })
        setProductLookupActive(false)
    }
    const updateLine = (index, key, value) => setItems(items.map((item, itemIndex) => {
        if (itemIndex !== index) return item
        if (key === 'quantity') return { ...item, [key]: Number(wholeNumberText(value)) || 1 }
        if (key === 'price') return { ...item, [key]: Number(wholeNumberText(value)) || 0 }
        if (key === 'gst') return { ...item, [key]: Number(value) }
        return { ...item, [key]: value }
    }))
    const removeLine = (index) => setItems(items.filter((_, itemIndex) => itemIndex !== index))
    const goNext = () => {
        if (step === 0 && (!customer.trim() || !mobile.trim())) return notify('Customer name and mobile number are required')
        if (step === 0 && !isTenDigitMobile(mobile)) return notify('Mobile number must be exactly 10 digits')
        if (step === 1 && !items.length) return notify('Add at least one product to continue')
        setStep(Math.min(step + 1, 3))
    }
    const resetBill = () => {
        setStep(0)
        setCustomer('')
        setMobile('')
        setBillingAddress(emptyAddress)
        setShippingAddress(emptyAddress)
        setShippingSameAsBilling(true)
        setItems([])
        setDraft({ name: '', price: '', gst: 18, quantity: 1, unit: 'Piece' })
        setProductLookupActive(false)
        setDiscount(0)
        setPaymentStatus('Paid')
        setAmountReceived(0)
        setSavedInvoice(null)
        setMatchedCustomer(null)
    }
    const fetchPdfUrl = async () => {
        if (!savedInvoice?.id) return null
        const response = await dataApi.invoicePdf(savedInvoice.id)
        return URL.createObjectURL(response.data)
    }
    const downloadPdf = async () => {
        try {
            const url = await fetchPdfUrl()
            if (!url) return notify('Invoice PDF is not ready yet')
            const link = document.createElement('a')
            link.href = url
            link.download = `Invoice-${savedInvoice.number}.pdf`
            link.click()
            setTimeout(() => URL.revokeObjectURL(url), 1000)
        } catch { notify('Could not download the invoice') }
    }
    const viewInvoice = async () => {
        try {
            const url = await fetchPdfUrl()
            if (!url) return notify('Invoice PDF is not ready yet')
            window.location.assign(url)
        } catch { notify('Could not open the invoice') }
    }
    const printInvoice = async () => {
        try {
            const url = await fetchPdfUrl()
            if (!url) return window.print()
            const tab = window.open(url, '_blank')
            if (tab) tab.addEventListener('load', () => tab.print())
        } catch { notify('Could not open the invoice for printing') }
    }
    const save = async (nextAction) => {
        if (!items.length) return notify('Add at least one product to the bill')
        if (!isTenDigitMobile(mobile)) return notify('Mobile number must be exactly 10 digits')
        setSaving(true)
        try {
            const savedProducts = await Promise.all(items.map(async (item, index) => {
                const payload = { name: item.name, productCode: item.code || `AUTO-${Date.now()}-${index + 1}`, sellingPrice: Number(item.price), gstRate: Number(item.gst), unit: item.unit }
                const response = item.productId && !String(item.productId).match(/^\d+$/) ? await dataApi.updateProduct(item.productId, payload) : await dataApi.createProduct(payload)
                return response.data
            }))
            const finalBillingAddress = formatAddress(billingAddress) || matchedCustomer?.address || ''
            const finalShippingAddress = shippingSameAsBilling ? finalBillingAddress : formatAddress(shippingAddress)
            const invoiceCustomer = { name: matchedCustomer?.name || customer, mobile: mobileDigits(mobile), state: customerState || businessState, gstin: matchedCustomer?.gstin || '', address: finalBillingAddress, billingAddress: finalBillingAddress, shippingAddress: finalShippingAddress, email: matchedCustomer?.email || '' }
            const paidNow = paymentStatus === 'Paid' ? totals.total : Math.min(Number(amountReceived) || 0, totals.total)
            const invoiceResponse = await dataApi.createInvoice({ customer: invoiceCustomer, businessState, items: items.map((item, index) => ({ productId: savedProducts[index]._id, productName: item.name, productCode: item.code || savedProducts[index].productCode, hsnCode: item.hsnCode || '', quantity: item.quantity, unit: item.unit, price: item.price, gstRate: item.gst })), discountType: 'percentage', discountValue: clampPercent(discount), discountAmount: totals.discountAmount, paymentMethod: 'UPI', paymentStatus, amountPaid: paidNow, invoiceDate: new Date().toISOString() })
            const invoice = invoiceResponse.data
            const normalizedProducts = savedProducts.map((product) => ({ ...product, id: product._id, code: product.productCode, price: product.sellingPrice, gst: product.gstRate }))
            const invoiceRecord = { id: invoice._id, number: invoice.invoiceNumber, customer: invoice.customer?.name || invoiceCustomer.name, mobile: invoice.customer?.mobile || mobileDigits(mobile), date: new Date(invoice.invoiceDate || invoice.createdAt).toLocaleDateString('en-IN'), amount: invoice.grandTotal, amountPaid: invoice.amountPaid || 0, balanceAmount: invoice.balanceAmount || 0, status: invoice.paymentStatus, method: invoice.paymentMethod, items: items.map((item) => ({ ...item })), subtotal: totals.subtotal, discount: totals.discountAmount, gst: totals.gst, taxMode }
            setProducts((current) => {
                const byId = new Map(current.map((product) => [product.id, product]))
                normalizedProducts.forEach((product) => byId.set(product.id, product))
                return Array.from(byId.values())
            })
            setInvoices((current) => [invoiceRecord, ...current])
            setSavedInvoice(invoiceRecord)
            setStep(3)
            notify(`Invoice ${invoice.invoiceNumber} created successfully`)
            if (nextAction === 'print') window.print()
        } catch { notify('Could not save the invoice or product details') }
        finally { setSaving(false) }
    }

    const lineItems = <div className="embedded-line-items"><div className="bill-items"><div className="bill-item header"><span>Product</span><span>Qty</span><span>Price</span><span>GST</span><span>Total</span><span /></div>{items.length === 0 && <div className="empty-lines">No products added yet.</div>}{items.map((item, index) => <div className="bill-item direct-line" key={`${item.productId || item.name}-${index}`}><input value={item.name} onChange={(event) => updateLine(index, 'name', event.target.value)} aria-label="Product name" /><input type="text" inputMode="numeric" pattern="[0-9]*" value={item.quantity} onChange={(event) => updateLine(index, 'quantity', event.target.value)} aria-label="Quantity" /><input type="text" inputMode="numeric" pattern="[0-9]*" value={item.price} onChange={(event) => updateLine(index, 'price', event.target.value)} aria-label="Price" /><select value={item.gst} onChange={(event) => updateLine(index, 'gst', event.target.value)} aria-label="GST rate"><option value="0">0%</option><option value="5">5%</option><option value="12">12%</option><option value="18">18%</option><option value="40">40%</option></select><strong>{money(item.price * item.quantity * (1 + item.gst / 100))}</strong><button onClick={() => removeLine(index)} aria-label="Remove line item"><Trash2 size={16} /></button></div>)}</div><div className="mobile-line-list">{items.length === 0 && <div className="empty-lines mobile-empty">No products added yet.</div>}{items.map((item, index) => <div className="mobile-line-card" key={`mobile-${item.productId || item.name}-${index}`}><div className="mobile-line-top"><input value={item.name} onChange={(event) => updateLine(index, 'name', event.target.value)} aria-label="Product name" /><button onClick={() => removeLine(index)} aria-label="Remove line item"><Trash2 size={16} /></button></div><div className="mobile-line-fields"><label>Qty<input type="text" inputMode="numeric" pattern="[0-9]*" value={item.quantity} onChange={(event) => updateLine(index, 'quantity', event.target.value)} /></label><label>Price<input type="text" inputMode="numeric" pattern="[0-9]*" value={item.price} onChange={(event) => updateLine(index, 'price', event.target.value)} /></label><label>GST<select value={item.gst} onChange={(event) => updateLine(index, 'gst', event.target.value)}><option value="0">0%</option><option value="5">5%</option><option value="12">12%</option><option value="18">18%</option><option value="40">40%</option></select></label></div><div className="mobile-line-total"><span>Total</span><strong>{money(item.price * item.quantity * (1 + item.gst / 100))}</strong></div></div>)}</div></div>
    const productForm = <section className="panel form-panel add-product-panel"><div className="section-head"><div><h3>Add product</h3></div><button className="primary-button small" onClick={addLine}><Plus size={15} /> Add line</button></div><div className="direct-product-form"><label className="product-name-field">Product name<div className="product-input-wrap"><input value={draft.name} onChange={(event) => { setDraft({ ...draft, name: event.target.value }); setProductLookupActive(true) }} placeholder="Start typing a product name" /><Search size={16} /></div>{suggestions.length > 0 && <div className="product-suggestions">{suggestions.map((product) => <button type="button" key={product.id} onClick={() => chooseProduct(product)}><span>{product.name}</span><strong>{money(product.price)}</strong></button>)}</div>}</label><label>Price<input type="text" inputMode="numeric" pattern="[0-9]*" value={draft.price} onChange={(event) => setDraft({ ...draft, price: wholeNumberText(event.target.value) })} placeholder="0" /></label><label>GST<select value={draft.gst} onChange={(event) => setDraft({ ...draft, gst: Number(event.target.value) })}><option value="0">0%</option><option value="5">5%</option><option value="12">12%</option><option value="18">18%</option><option value="40">40%</option></select></label><label>Qty<input type="text" inputMode="numeric" pattern="[0-9]*" value={draft.quantity} onChange={(event) => setDraft({ ...draft, quantity: wholeNumberText(event.target.value) })} /></label></div><button className="primary-button wide mobile-add-line" onClick={addLine}><Plus size={16} /> Add to list</button>{lineItems}</section>
    const updateBillingAddress = (key, value) => {
        const nextAddress = { ...billingAddress, [key]: key === 'pinCode' ? wholeNumberText(value).slice(0, 6) : value }
        setBillingAddress(nextAddress)
        if (shippingSameAsBilling) setShippingAddress(nextAddress)
        if (key === 'pinCode' && nextAddress.pinCode.length === 6) lookupPinCode(nextAddress.pinCode, 'billing')
    }
    const updateShippingAddress = (key, value) => {
        const nextAddress = { ...shippingAddress, [key]: key === 'pinCode' ? wholeNumberText(value).slice(0, 6) : value }
        setShippingAddress(nextAddress)
        if (key === 'pinCode' && nextAddress.pinCode.length === 6) lookupPinCode(nextAddress.pinCode, 'shipping')
    }
    const lookupPinCode = async (pinCode, addressType) => {
        try {
            const response = await dataApi.lookupPinCode(pinCode)
            const location = response.data || {}
            if (addressType === 'billing') {
                setBillingAddress((current) => ({ ...current, pinCode, city: location.city || '', state: location.state || '' }))
                if (shippingSameAsBilling) setShippingAddress((current) => ({ ...current, pinCode, city: location.city || '', state: location.state || '' }))
                return
            }
            setShippingAddress((current) => ({ ...current, pinCode, city: location.city || '', state: location.state || '' }))
        } catch (error) {
            notify(error.response?.data?.message || 'Could not find city and state for this PIN code')
        }
    }
    const addressFields = (address, updateAddress, prefix) => <><label className="full">{prefix} address<input value={address.line1} onChange={(event) => updateAddress('line1', event.target.value)} placeholder="Street, building, area" /></label><label>{prefix} PIN code<input type="text" inputMode="numeric" pattern="[0-9]*" maxLength="6" value={address.pinCode} onChange={(event) => updateAddress('pinCode', event.target.value)} placeholder="400001" /></label><label>{prefix} city<input value={address.city} onChange={(event) => updateAddress('city', event.target.value)} placeholder="City" /></label><label>{prefix} state<input value={address.state} onChange={(event) => updateAddress('state', event.target.value)} placeholder="State" /></label></>
    const customerFields = <><div className="form-grid three customer-entry-grid"><label className="customer-search-field">Mobile number<div className="product-input-wrap"><input type="tel" inputMode="numeric" maxLength="10" value={mobile} onChange={(event) => updateMobile(event.target.value)} placeholder="9876543210" /><Search size={16} /></div>{customerSuggestions.length > 0 && <div className="product-suggestions customer-suggestions">{customerSuggestions.map((savedCustomer) => <button type="button" key={savedCustomer._id || `${savedCustomer.mobile}-${savedCustomer.name}`} onClick={() => chooseCustomer(savedCustomer)}><span>{savedCustomer.mobile}</span><strong>{savedCustomer.name}</strong></button>)}</div>}</label><label>Customer name<input value={customer} onChange={(event) => updateCustomer(event.target.value)} placeholder="Enter customer name" /></label>{addressFields(billingAddress, updateBillingAddress, 'Billing')}<label className="full checkbox-line"><input type="checkbox" checked={shippingSameAsBilling} onChange={(event) => { setShippingSameAsBilling(event.target.checked); if (event.target.checked) setShippingAddress(billingAddress) }} /> Ship to address same as billing address</label>{!shippingSameAsBilling && addressFields(shippingAddress, updateShippingAddress, 'Shipping')}</div></>
    const summary = <aside className="bill-summary"><div><span>Subtotal</span><strong>{money(totals.subtotal)}</strong></div><div><span>Discount <small>(before GST)</small></span><label className="discount-field"><input type="text" inputMode="decimal" value={discount} onChange={(event) => setDiscount(clampPercent(numericText(event.target.value)))} />%</label></div><div><span>Taxable amount</span><strong>{money(totals.taxable)}</strong></div>{taxMode === 'igst' ? <div><span>IGST</span><strong>{money(totals.gst)}</strong></div> : <><div><span>CGST</span><strong>{money(totals.gst / 2)}</strong></div><div><span>SGST</span><strong>{money(totals.gst / 2)}</strong></div></>}<div className="summary-total"><span>Grand total</span><strong>{money(totals.total)}</strong></div><label className="payment-select">Payment status<select value={paymentStatus} onChange={(event) => { setPaymentStatus(event.target.value); if (event.target.value === 'Paid') setAmountReceived(totals.total) }}><option>Paid</option><option>Unpaid</option><option>Partially paid</option></select></label>{paymentStatus !== 'Paid' && <label className="payment-select amount-received-field">Amount received<input type="text" inputMode="numeric" pattern="[0-9]*" value={amountReceived} onChange={(event) => setAmountReceived(Math.min(Number(wholeNumberText(event.target.value)) || 0, totals.total))} placeholder="0" /></label>}<button className="dark-button wide desktop-save" onClick={() => save()} disabled={saving}><CheckCircle2 size={17} /> {saving ? 'Saving...' : 'Save bill'}</button><button className="secondary-button wide desktop-save" onClick={() => save('print')} disabled={saving}><Printer size={17} /> Save & print</button></aside>
    return <><div className="page bill-page"><div className="mobile-stepper">{steps.map((label, index) => <button key={label} className={index === step ? 'active' : index < step ? 'complete' : ''} onClick={() => setStep(index)}><span>{index + 1}</span><small>{label}</small></button>)}</div><div className="bill-layout desktop-bill-layout"><div><section className="panel form-panel"><div className="section-head"><div><h3>Customer details</h3></div></div>{customerFields}</section>{productForm}</div>{summary}</div><div className="mobile-bill-flow">{step === 0 && <section className="panel mobile-step-card"><h3>Customer details</h3>{customerFields}</section>}{step === 1 && <>{productForm}{summary}</>}{step === 2 && <><section className="panel mobile-step-card review-card"><div className="review-head"><h3>Invoice preview</h3><button className="secondary-button small"><Eye size={15} /> Preview</button></div><div className="review-block"><div><h4>Customer details</h4><p>{customer}</p><p>{mobile}</p><p>{taxMode === 'igst' ? 'IGST (interstate)' : 'CGST + SGST (same state)'}</p></div><button className="text-button" onClick={() => setStep(0)}>Edit</button></div><div className="review-block"><div><h4>Items ({items.length})</h4>{items.map((item, index) => <div className="review-line" key={`${item.name}-${index}`}><span>{item.name}<small>{item.quantity} x {money(item.price)} · GST {item.gst}%</small></span><strong>{money(item.price * item.quantity * (1 + item.gst / 100))}</strong></div>)}</div><button className="text-button" onClick={() => setStep(1)}>Edit</button></div></section>{summary}</>}{step === 3 && <section className="mobile-success"><CheckCircle2 size={78} /><h2>Bill Created Successfully!</h2><p>Invoice has been saved.</p><div className="success-card"><span>Invoice No.</span><strong>{savedInvoice?.number || 'Generated on save'}</strong><span>Customer</span><strong>{savedInvoice?.customer || customer}</strong><span>Grand Total</span><strong>{money(savedInvoice?.amount || totals.total)}</strong><span>Date</span><strong>{savedInvoice?.date || new Date().toLocaleDateString('en-IN')}</strong></div>{savedInvoice?.items?.length > 0 && <div className="success-items">{savedInvoice.items.map((item, index) => <div className="review-line" key={`${item.name}-${index}`}><span>{item.name}<small>{item.quantity} x {money(item.price)} · GST {item.gst}%</small></span><strong>{money(item.price * item.quantity * (1 + item.gst / 100))}</strong></div>)}</div>}<button className="primary-button wide" onClick={viewInvoice}><Eye size={17} /> View Invoice</button><button className="secondary-button wide" onClick={printInvoice}><Printer size={17} /> Save & Print</button><button className="secondary-button wide" onClick={downloadPdf}><Download size={17} /> Download PDF</button><button className="secondary-button wide" onClick={() => notify('Share from your browser or downloaded PDF')}><Share2 size={17} /> Share</button><button className="secondary-button wide" onClick={resetBill}><FileText size={17} /> Create New Bill</button></section>}</div>{step < 3 && <div className="mobile-action-bar">{step > 0 ? <button className="secondary-button" onClick={() => setStep(step - 1)}><ArrowLeft size={17} /> Back</button> : <span />}{step === 2 ? <button className="primary-button" onClick={() => save()} disabled={saving}>{saving ? 'Saving...' : 'Save bill'} <CheckCircle2 size={17} /></button> : <button className="primary-button" onClick={goNext}>Next <ArrowRight size={17} /></button>}</div>}</div></>
}





