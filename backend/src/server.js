require('express-async-errors')
const express = require('express')
const cors = require('cors')
const mongoose = require('mongoose')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const PDFDocument = require('pdfkit')
require('dotenv').config()

const app = express()
const allowedOrigins = (process.env.CLIENT_URL || 'http://localhost:5173,http://localhost:5174').split(',').map((origin) => origin.trim()).filter(Boolean)
app.use(cors({ origin: (origin, callback) => { if (!origin || allowedOrigins.includes(origin)) return callback(null, true); return callback(new Error('Origin is not allowed')) } }))
app.use(express.json({ limit: '5mb' }))

const userSchema = new mongoose.Schema({ name: String, email: { type: String, unique: true, lowercase: true }, password: String }, { timestamps: true })
const productSchema = new mongoose.Schema({ name: { type: String, required: true }, productCode: { type: String, required: true, index: true }, sellingPrice: { type: Number, min: 0, required: true }, gstRate: { type: Number, min: 0, max: 100, required: true }, hsnCode: String, unit: String, description: String, priceIncludesGST: { type: Boolean, default: false }, isActive: { type: Boolean, default: true } }, { timestamps: true })
const customerSchema = new mongoose.Schema({ name: { type: String, required: true }, mobile: { type: String, required: true, index: true }, email: String, address: String, state: String, gstin: String, lastBilledAt: Date }, { timestamps: true })
const invoiceItemSchema = new mongoose.Schema({ productId: mongoose.Schema.Types.ObjectId, productName: String, productCode: String, hsnCode: String, quantity: Number, unit: String, price: Number, gstRate: Number, taxableAmount: Number, cgstRate: Number, cgstAmount: Number, sgstRate: Number, sgstAmount: Number, igstRate: Number, igstAmount: Number, total: Number }, { _id: false })
const invoiceSchema = new mongoose.Schema({ invoiceNumber: { type: String, unique: true, index: true }, invoiceSequence: { type: Number, unique: true }, customer: Object, items: [invoiceItemSchema], subtotal: Number, discountType: String, discountValue: Number, discountAmount: Number, taxableAmount: Number, cgstTotal: Number, sgstTotal: Number, igstTotal: Number, totalGST: Number, roundOff: Number, grandTotal: Number, paymentMethod: String, paymentStatus: String, amountPaid: Number, balanceAmount: Number, invoiceDate: Date, createdBy: mongoose.Schema.Types.ObjectId }, { timestamps: true })
const settingsSchema = new mongoose.Schema({ userId: { type: mongoose.Schema.Types.ObjectId, unique: true }, businessName: String, ownerName: String, address: String, city: String, state: String, pinCode: String, phone: String, email: String, gstin: String, logoDataUrl: String, qrDataUrl: String, invoicePrefix: { type: String, default: 'INV' }, nextInvoiceNumber: { type: Number, default: 1 }, defaultGstRate: { type: Number, default: 18 }, allowRateEditing: { type: Boolean, default: true }, bankDetails: Object, upiId: String, terms: String }, { timestamps: true })
const counterSchema = new mongoose.Schema({ key: { type: String, unique: true }, value: { type: Number, default: 0 } })
const User = mongoose.model('User', userSchema); const Product = mongoose.model('Product', productSchema); const Customer = mongoose.model('Customer', customerSchema); const Invoice = mongoose.model('Invoice', invoiceSchema); const Settings = mongoose.model('Settings', settingsSchema); const Counter = mongoose.model('Counter', counterSchema)

const auth = (req, res, next) => { const token = req.headers.authorization?.replace('Bearer ', ''); if (!token) return res.status(401).json({ message: 'Authentication required' }); try { req.user = jwt.verify(token, process.env.JWT_SECRET || 'development-secret'); next() } catch { return res.status(401).json({ message: 'Invalid or expired session' }) } }
const round = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100
const mobileDigits = (value = '') => String(value).replace(/\D/g, '').slice(-10)
const numberWords = (value) => { const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']; const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']; const underHundred = (number) => number < 20 ? ones[number] : `${tens[Math.floor(number / 10)]}${number % 10 ? ` ${ones[number % 10]}` : ''}`; const underThousand = (number) => number < 100 ? underHundred(number) : `${ones[Math.floor(number / 100)]} Hundred${number % 100 ? ` ${underHundred(number % 100)}` : ''}`; const amount = Math.floor(Number(value || 0)); if (amount === 0) return 'Zero Rupees'; const parts = []; const crore = Math.floor(amount / 10000000); const lakh = Math.floor((amount % 10000000) / 100000); const thousand = Math.floor((amount % 100000) / 1000); const remainder = amount % 1000; if (crore) parts.push(`${underThousand(crore)} Crore`); if (lakh) parts.push(`${underThousand(lakh)} Lakh`); if (thousand) parts.push(`${underThousand(thousand)} Thousand`); if (remainder) parts.push(underThousand(remainder)); return `${parts.join(' ')} Rupees`; }
const hasValidMobile = (value) => /^\d{10}$/.test(mobileDigits(value))
const logoPattern = /^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/
const logoBuffer = (dataUrl) => dataUrl ? Buffer.from(dataUrl.split(',')[1], 'base64') : null
const errorHandler = (error, req, res, next) => { console.error(error); if (error.code === 11000) return res.status(409).json({ message: 'An account with that email already exists' }); if (error.name === 'ValidationError') return res.status(400).json({ message: Object.values(error.errors).map((item) => item.message).join(', ') }); return res.status(error.status || 500).json({ message: 'Something went wrong. Please try again.' }) }

app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'ledgerly-api' }))
app.post('/api/auth/register', async (req, res) => { const { name, email, password } = req.body; if (!name || !email || !password || password.length < 8) return res.status(400).json({ message: 'Name, email and an 8-character password are required' }); const user = await User.create({ name, email, password: await bcrypt.hash(password, 12) }); res.status(201).json({ id: user.id, name: user.name, email: user.email }) })
app.post('/api/auth/login', async (req, res) => { const user = await User.findOne({ email: req.body.email }); if (!user || !(await bcrypt.compare(req.body.password || '', user.password))) return res.status(401).json({ message: 'Invalid email or password' }); const token = jwt.sign({ id: user.id, name: user.name, email: user.email }, process.env.JWT_SECRET || 'development-secret', { expiresIn: '7d' }); res.json({ token, user: { id: user.id, name: user.name, email: user.email } }) })
app.get('/api/products', auth, async (req, res) => res.json(await Product.find({ isActive: true }).sort({ createdAt: -1 }).limit(200)))
app.post('/api/products', auth, async (req, res) => res.status(201).json(await Product.create(req.body)))
app.put('/api/products/:id', auth, async (req, res) => res.json(await Product.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true })))
app.delete('/api/products/:id', auth, async (req, res) => { await Product.findByIdAndUpdate(req.params.id, { isActive: false }); res.status(204).end() })
app.get('/api/customers', auth, async (req, res) => { const query = req.query.search ? { $or: [{ name: new RegExp(req.query.search, 'i') }, { mobile: new RegExp(req.query.search, 'i') }] } : {}; res.json(await Customer.find(query).sort({ name: 1 })) })
app.post('/api/customers', auth, async (req, res) => { if (!hasValidMobile(req.body.mobile)) return res.status(400).json({ message: 'Mobile number must be exactly 10 digits' }); res.status(201).json(await Customer.create({ ...req.body, mobile: mobileDigits(req.body.mobile) })) })
app.put('/api/customers/:id', auth, async (req, res) => { if (req.body.mobile && !hasValidMobile(req.body.mobile)) return res.status(400).json({ message: 'Mobile number must be exactly 10 digits' }); res.json(await Customer.findByIdAndUpdate(req.params.id, { ...req.body, mobile: req.body.mobile ? mobileDigits(req.body.mobile) : req.body.mobile }, { new: true, runValidators: true })) })
app.delete('/api/customers/:id', auth, async (req, res) => { await Customer.findByIdAndDelete(req.params.id); res.status(204).end() })
app.get('/api/location/pincode/:pinCode', auth, async (req, res) => {
    const pinCode = String(req.params.pinCode || '').replace(/\D/g, '')
    if (!/^\d{6}$/.test(pinCode)) return res.status(400).json({ message: 'PIN code must be exactly 6 digits' })
    const response = await fetch(`https://api.postalpincode.in/pincode/${pinCode}`)
    if (!response.ok) return res.status(502).json({ message: 'PIN lookup service is unavailable' })
    const data = await response.json()
    const postOffice = data?.[0]?.PostOffice?.[0]
    if (!postOffice || data?.[0]?.Status !== 'Success') return res.status(404).json({ message: 'No city or state found for this PIN code' })
    res.json({ pinCode, city: postOffice.District || postOffice.Block || postOffice.Name || '', state: postOffice.State || '' })
})
app.get('/api/invoices', auth, async (req, res) => { const page = Math.max(Number(req.query.page) || 1, 1); const limit = Math.min(Number(req.query.limit) || 20, 100); const filter = {}; if (req.query.status) filter.paymentStatus = req.query.status; if (req.query.search) filter.$or = [{ invoiceNumber: new RegExp(req.query.search, 'i') }, { 'customer.name': new RegExp(req.query.search, 'i') }, { 'customer.mobile': new RegExp(req.query.search, 'i') }]; const [data, total] = await Promise.all([Invoice.find(filter).sort({ invoiceDate: -1 }).skip((page - 1) * limit).limit(limit), Invoice.countDocuments(filter)]); res.json({ data, page, pages: Math.ceil(total / limit), total }) })
app.post('/api/invoices', auth, async (req, res) => { const payload = { ...req.body, customer: { ...req.body.customer, mobile: mobileDigits(req.body.customer?.mobile) } }; if (!payload.items?.length) return res.status(400).json({ message: 'At least one invoice item is required' }); if (!hasValidMobile(payload.customer?.mobile)) return res.status(400).json({ message: 'Customer mobile number must be exactly 10 digits' }); const counter = await Counter.findOneAndUpdate({ key: 'invoice' }, { $inc: { value: 1 } }, { new: true, upsert: true, setDefaultsOnInsert: true }); const settings = await Settings.findOne({ userId: req.user.id }); const prefix = settings?.invoicePrefix || 'INV'; const items = payload.items.map((item) => { const taxableAmount = round(Number(item.quantity) * Number(item.price)); const gst = round(taxableAmount * Number(item.gstRate) / 100); const interstate = payload.businessState && payload.customer?.state && payload.businessState !== payload.customer.state; return { ...item, taxableAmount, cgstRate: interstate ? 0 : Number(item.gstRate) / 2, cgstAmount: interstate ? 0 : round(gst / 2), sgstRate: interstate ? 0 : Number(item.gstRate) / 2, sgstAmount: interstate ? 0 : round(gst / 2), igstRate: interstate ? Number(item.gstRate) : 0, igstAmount: interstate ? gst : 0, total: round(taxableAmount + gst) } }); const subtotal = round(items.reduce((sum, item) => sum + item.taxableAmount, 0)); const discountAmount = round(Number(payload.discountAmount) || 0); const taxableAmount = round(subtotal - discountAmount); const cgstTotal = round(items.reduce((sum, item) => sum + item.cgstAmount, 0)); const sgstTotal = round(items.reduce((sum, item) => sum + item.sgstAmount, 0)); const igstTotal = round(items.reduce((sum, item) => sum + item.igstAmount, 0)); const grandTotal = round(taxableAmount + cgstTotal + sgstTotal + igstTotal); const paidAmount = Math.min(Math.max(Number(payload.amountPaid) || 0, 0), grandTotal); const balanceAmount = round(grandTotal - paidAmount); const paymentStatus = paidAmount >= grandTotal ? 'Paid' : paidAmount > 0 ? 'Partially paid' : 'Unpaid'; const invoiceDate = payload.invoiceDate ? new Date(payload.invoiceDate) : new Date(); await Customer.findOneAndUpdate({ mobile: payload.customer.mobile }, { name: payload.customer.name || 'Customer', mobile: payload.customer.mobile, state: payload.customer.state, gstin: payload.customer.gstin, address: payload.customer.address, lastBilledAt: invoiceDate }, { upsert: true, new: true, setDefaultsOnInsert: true }); const invoice = await Invoice.create({ ...payload, invoiceDate, items, invoiceSequence: counter.value, invoiceNumber: `${prefix}-${String(counter.value).padStart(6, '0')}`, subtotal, discountAmount, taxableAmount, cgstTotal, sgstTotal, igstTotal, totalGST: round(cgstTotal + sgstTotal + igstTotal), grandTotal, paymentStatus, amountPaid: paidAmount, balanceAmount, createdBy: req.user.id }); res.status(201).json(invoice) })
app.patch('/api/invoices/:id/payment', auth, async (req, res) => { const invoice = await Invoice.findOne({ _id: req.params.id, createdBy: req.user.id }); if (!invoice) return res.status(404).json({ message: 'Invoice not found' }); const amountReceived = Math.max(Number(req.body.amountReceived) || 0, 0); if (amountReceived <= 0) return res.status(400).json({ message: 'Amount received must be greater than zero' }); const grandTotal = Number(invoice.grandTotal) || 0; const amountPaid = Math.min(round(Number(invoice.amountPaid || 0) + amountReceived), grandTotal); const balanceAmount = round(grandTotal - amountPaid); invoice.amountPaid = amountPaid; invoice.balanceAmount = balanceAmount; invoice.paymentStatus = amountPaid >= grandTotal ? 'Paid' : amountPaid > 0 ? 'Partially paid' : 'Unpaid'; await invoice.save(); res.json(invoice) })
app.delete('/api/invoices/:id', auth, async (req, res) => { const invoice = await Invoice.findOneAndDelete({ _id: req.params.id, createdBy: req.user.id }); if (!invoice) return res.status(404).json({ message: 'Invoice not found' }); res.status(204).end() })
app.get('/api/invoices/:id/pdf', auth, async (req, res) => {
    const invoice = await Invoice.findById(req.params.id)
    if (!invoice) return res.status(404).json({ message: 'Invoice not found' })
    const settings = await Settings.findOne({ userId: invoice.createdBy || req.user.id })
    const bank = settings?.bankDetails || {}
    const doc = new PDFDocument({ size: 'A4', margin: 32 })
    const currency = (value) => Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    const shortDate = (value) => new Date(value || Date.now()).toLocaleDateString('en-IN')
    const pageWidth = doc.page.width
    const pageHeight = doc.page.height
    const bronze = '#b57505'
    const bronzeDark = '#704400'
    const gold = '#d69a13'
    const paleGold = '#fbf6ea'
    const ink = '#111827'
    const muted = '#4b5563'
    const lineColor = '#ead8b9'
    const invoiceDate = invoice.invoiceDate || invoice.createdAt
    const address = [settings?.address, settings?.city, settings?.state, settings?.pinCode].filter(Boolean).join(', ')
    const customerAddress = invoice.customer?.billingAddress || invoice.customer?.address || invoice.customer?.state || ''
    const shippingAddress = invoice.customer?.shippingAddress || customerAddress
    const addressParts = (value = '') => {
        const parts = String(value || '').split(',').map((part) => part.trim()).filter(Boolean)
        const pinFromText = String(value || '').match(/\b\d{6}\b/)?.[0] || ''
        const pinIndex = parts.findIndex((part) => /\b\d{6}\b/.test(part))
        const pinCode = pinFromText || ''
        const withoutPin = parts.filter((_, index) => index !== pinIndex)
        const state = withoutPin.length > 2 ? withoutPin[withoutPin.length - 1] : invoice.customer?.state || ''
        const city = withoutPin.length > 1 ? withoutPin[withoutPin.length - 2] : ''
        const line1 = withoutPin.length > 2 ? withoutPin.slice(0, -2).join(', ') : withoutPin[0] || ''
        return { line1, city, state, pinCode }
    }
    const rowsPerFirstPage = 3
    const rowsPerNextPage = 9
    const chunks = []
    invoice.items.forEach((item, index) => {
        const limit = chunks.length ? rowsPerNextPage : rowsPerFirstPage
        if (!chunks.length || chunks[chunks.length - 1].length >= limit) chunks.push([])
        chunks[chunks.length - 1].push({ item, serial: index + 1 })
    })
    const totalPages = Math.max(chunks.length, 1)

    const drawWaveChrome = (pageNumber) => {
        doc.save()
        doc.rect(0, 0, pageWidth, pageHeight).fill('#ffffff')
        doc.path(`M0 0 L${pageWidth} 0 L${pageWidth} 34 C505 58 452 60 393 39 C314 11 204 0 96 19 C58 26 25 45 0 69 Z`).fill('#f7f1e6')
        doc.path(`M355 0 C422 11 470 76 557 9 L${pageWidth} 0 Z`).fill('#f1c455')
        doc.path(`M446 0 C486 51 535 46 ${pageWidth} 2 L${pageWidth} 0 Z`).fill(bronzeDark)
        doc.restore()

        roundedBox(30, 66, 118, 88, '#ffffff')
        if (settings?.logoDataUrl && logoPattern.test(settings.logoDataUrl)) {
            try {
                doc.image(logoBuffer(settings.logoDataUrl), 41, 76, { fit: [96, 66], align: 'center', valign: 'center' })
            } catch (error) {
                console.error('Could not render invoice logo:', error.message)
                doc.font('Helvetica-Bold').fontSize(10).fillColor(bronze).text(settings?.businessName || 'Logo', 46, 103, { width: 86, align: 'center' })
            }
        } else {
            doc.font('Helvetica-Bold').fontSize(10).fillColor(bronze).text(settings?.businessName || 'Business Logo', 46, 103, { width: 86, align: 'center' })
        }

        doc.font('Helvetica-Bold').fontSize(22).fillColor(bronze).text(settings?.businessName || 'Trading Company', 166, 76, { width: 235 })
        doc.moveTo(166, 105).lineTo(330, 105).lineWidth(1).strokeColor(gold).stroke()
        doc.font('Helvetica').fontSize(8).fillColor(muted).text(`GSTIN: ${settings?.gstin || '-'}`, 166, 114)
        if (pageNumber === 1) {
            doc.font('Helvetica').fontSize(8).fillColor(muted).text(`Phone: ${settings?.phone || '-'}`, 166, 130)
            doc.text(`Email: ${settings?.email || '-'}`, 300, 130)
            doc.text(address || 'Business address', 166, 145, { width: 330 })
            if (settings?.ownerName) doc.text(`Owner: ${settings.ownerName}`, 166, 160, { width: 250 })
        }
        doc.font('Helvetica-Bold').fontSize(15).fillColor(bronzeDark).text('TAX INVOICE', 375, 76, { width: 155, align: 'right', lineBreak: false })
        doc.font('Helvetica').fontSize(8).fillColor(muted).text(`Invoice No: ${invoice.invoiceNumber}`, 390, 104, { width: 140, align: 'right' })
        doc.text(`Page ${pageNumber} of ${totalPages}`, 390, 120, { width: 140, align: 'right' })
        doc.font('Helvetica').fontSize(8).fillColor(ink).text(`Page ${pageNumber} of ${totalPages}`, 465, 760, { width: 70, align: 'right' })
    }
    const roundedBox = (x, y, w, h, fill = '#ffffff') => doc.roundedRect(x, y, w, h, 7).fillAndStroke(fill, lineColor)
    const iconCircle = (x, y, label) => {
        doc.circle(x, y, 13).fill(bronze)
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#ffffff').text(label, x - 7, y - 5, { width: 14, align: 'center' })
    }
    const drawTable = (items, yStart) => {
        const cols = [42, 82, 314, 358, 414, 468, 518]
        const widths = [28, 218, 35, 50, 50, 40, 42]
        doc.roundedRect(30, yStart, 535, 27, 5).fill(bronze)
        ;['No.', 'Item Description', 'Qty.', 'MRP (Rs.)', 'Rate (Rs.)', 'Tax', 'Amount (Rs.)'].forEach((heading, index) => {
            doc.font('Helvetica-Bold').fontSize(7.2).fillColor('#ffffff').text(heading, cols[index], yStart + 10, { width: widths[index], align: index > 1 ? 'right' : 'left', lineBreak: false })
        })
        let y = yStart + 27
        items.forEach(({ item, serial }, index) => {
            const rowFill = index % 2 ? '#fffaf2' : '#ffffff'
            doc.rect(30, y, 535, 34).fillAndStroke(rowFill, lineColor)
            doc.font('Helvetica').fontSize(7.5).fillColor(ink)
            doc.text(String(serial), cols[0], y + 10, { width: widths[0], align: 'center' })
            doc.font('Helvetica-Bold').text(item.productName || 'Product', cols[1], y + 10, { width: widths[1], height: 14, ellipsis: true })
            doc.font('Helvetica').fontSize(7.5).fillColor(ink).text(String(item.quantity || 0), cols[2], y + 10, { width: widths[2], align: 'right' })
            doc.text(currency(item.price), cols[3], y + 10, { width: widths[3], align: 'right' })
            doc.text(currency(item.price), cols[4], y + 10, { width: widths[4], align: 'right' })
            doc.text(`${item.gstRate || 0}%`, cols[5], y + 10, { width: widths[5], align: 'right' })
            doc.text(currency(item.total || item.taxableAmount), cols[6], y + 10, { width: widths[6], align: 'right' })
            y += 34
        })
        return y
    }
    const drawDetails = () => {
        doc.rect(30, 178, 535, 6).fill(ink)
        doc.rect(30, 184, 535, 48).fill(paleGold)
        doc.font('Helvetica-Bold').fontSize(9).fillColor(ink).text('Invoice No.:', 45, 201)
        doc.font('Helvetica').fontSize(9).text(invoice.invoiceNumber, 107, 201, { width: 120 })
        doc.font('Helvetica-Bold').fontSize(9).text('Invoice Date:', 235, 201)
        doc.font('Helvetica').fontSize(9).text(shortDate(invoiceDate), 303, 201, { width: 115 })
        doc.font('Helvetica-Bold').fontSize(9).text('Due Date:', 436, 201)
        doc.font('Helvetica').fontSize(9).text(shortDate(invoiceDate), 489, 201, { width: 65 })

        const drawPartyCard = (x, title, addressText) => {
            const parts = addressParts(addressText)
            roundedBox(x, 246, 255, 96, '#ffffff')
            doc.font('Helvetica-Bold').fontSize(10.5).fillColor(bronzeDark).text(title, x + 14, 256)
            doc.font('Helvetica-Bold').fontSize(8.8).fillColor(ink).text(invoice.customer?.name || 'Customer', x + 14, 274, { width: 220, height: 11, ellipsis: true })
            doc.font('Helvetica').fontSize(7.2).fillColor(ink).text(parts.line1 || '-', x + 14, 288, { width: 220, height: 10, ellipsis: true })
            doc.text(`City: ${parts.city || '-'}`, x + 14, 302, { width: 105, height: 10, ellipsis: true })
            doc.text(`PIN: ${parts.pinCode || '-'}`, x + 135, 302, { width: 90, height: 10, ellipsis: true })
            doc.text(`State: ${parts.state || invoice.customer?.state || '-'}`, x + 14, 316, { width: 105, height: 10, ellipsis: true })
            doc.text(`Mobile: ${invoice.customer?.mobile || '-'}`, x + 135, 316, { width: 95, height: 10, ellipsis: true })
        }
        drawPartyCard(30, 'BILL TO', customerAddress)
        drawPartyCard(310, 'SHIP TO', shippingAddress, false)
    }
    const drawFinalSections = (top) => {
        const footerTop = Math.max(top + 20, 485)
        roundedBox(30, footerTop, 265, 54, paleGold)
        iconCircle(54, footerTop + 25, 'Rs')
        doc.font('Helvetica-Bold').fontSize(9).fillColor(bronzeDark).text('Amount in Words', 78, footerTop + 17)
        doc.font('Helvetica').fontSize(8).fillColor(ink).text(`${numberWords(invoice.grandTotal)} Only`, 78, footerTop + 34, { width: 195 })

        roundedBox(310, footerTop, 255, 151, '#ffffff')
        const taxRows = Number(invoice.igstTotal || 0) > 0 ? [['IGST', invoice.igstTotal]] : [['CGST', invoice.cgstTotal], ['SGST', invoice.sgstTotal]]
        const totals = [['Subtotal', invoice.subtotal], ['Taxable Amount', invoice.taxableAmount], ...taxRows]
        totals.forEach(([label, value], index) => {
            doc.font('Helvetica').fontSize(8).fillColor(ink).text(label, 324, footerTop + 13 + index * 17)
            doc.text(`Rs.${currency(value)}`, 456, footerTop + 13 + index * 17, { width: 85, align: 'right' })
        })
        doc.moveTo(324, footerTop + 82).lineTo(546, footerTop + 82).strokeColor(gold).stroke()
        doc.font('Helvetica-Bold').fontSize(9).fillColor(ink).text('Total Amount', 324, footerTop + 91)
        doc.text(`Rs.${currency(invoice.grandTotal)}`, 456, footerTop + 91, { width: 85, align: 'right' })
        doc.font('Helvetica').fontSize(8).text('Received Amount', 324, footerTop + 119)
        doc.text(`Rs.${currency(invoice.amountPaid)}`, 456, footerTop + 119, { width: 85, align: 'right' })
        doc.text('Current Balance', 324, footerTop + 134)
        doc.text(`Rs.${currency(invoice.balanceAmount)}`, 456, footerTop + 134, { width: 85, align: 'right' })
        doc.roundedRect(310, footerTop + 151, 255, 35, 3).fill(bronze)
        doc.font('Helvetica-Bold').fontSize(10).fillColor('#ffffff').text('Grand Total', 324, footerTop + 162)
        doc.fontSize(17).text(`Rs.${currency(invoice.grandTotal)}`, 420, footerTop + 158, { width: 126, align: 'right' })

        roundedBox(30, footerTop + 68, 265, 67, '#ffffff')
        iconCircle(54, footerTop + 96, 'T')
        doc.font('Helvetica-Bold').fontSize(9).fillColor(bronzeDark).text('Terms & Conditions', 78, footerTop + 82)
        doc.font('Helvetica').fontSize(7).fillColor(muted).text(settings?.terms || 'Goods once sold will not be taken back or exchanged.\nWarranty as per manufacturer policy.\nAll disputes are subject to local jurisdiction only.', 78, footerTop + 100, { width: 195 })

        roundedBox(30, footerTop + 149, 265, 92, '#ffffff')
        iconCircle(54, footerTop + 182, 'B')
        doc.font('Helvetica-Bold').fontSize(9).fillColor(bronzeDark).text('Bank Details', 78, footerTop + 164)
        const bankRows = [['Name', bank.accountHolder || settings?.businessName || '-'], ['IFSC Code', bank.ifscCode || '-'], ['Account No.', bank.accountNumber || '-'], ['Bank', bank.bankName || '-'], ['UPI ID', settings?.upiId || '-']]
        bankRows.forEach(([label, value], index) => {
            const rowY = footerTop + 183 + index * 12
            doc.font('Helvetica-Bold').fontSize(6.7).fillColor(muted).text(label, 78, rowY, { width: 58 })
            doc.font('Helvetica').fontSize(6.7).fillColor(ink).text(value, 138, rowY, { width: 82 })
        })
        const qrX = 228
        const qrY = footerTop + 171
        doc.roundedRect(qrX, qrY, 52, 52, 3).fillAndStroke('#ffffff', lineColor)
        if (settings?.qrDataUrl && logoPattern.test(settings.qrDataUrl)) {
            try {
                doc.image(logoBuffer(settings.qrDataUrl), qrX + 4, qrY + 4, { fit: [44, 44], align: 'center', valign: 'center' })
            } catch (error) {
                console.error('Could not render payment QR:', error.message)
            }
        }
        if (!(settings?.qrDataUrl && logoPattern.test(settings.qrDataUrl)) && settings?.upiId) {
            for (let row = 0; row < 9; row += 1) {
                for (let col = 0; col < 9; col += 1) {
                    if ((row * 3 + col * 5 + String(settings.upiId).length) % 4 < 2) doc.rect(qrX + 6 + col * 4.5, qrY + 6 + row * 4.5, 3.2, 3.2).fillColor(ink).fill()
                }
            }
        }
        doc.font('Helvetica-Bold').fontSize(6).fillColor(bronzeDark).text('Payment QR Code', 220, footerTop + 226, { width: 68, align: 'center' })

        roundedBox(310, footerTop + 205, 255, 67, '#ffffff')
        doc.moveTo(375, footerTop + 245).lineTo(500, footerTop + 245).strokeColor(gold).stroke()
        doc.font('Helvetica-Bold').fontSize(8).fillColor(ink).text('Authorised Signatory', 375, footerTop + 251, { width: 125, align: 'center' })
        doc.font('Helvetica').fontSize(7).fillColor(muted).text(settings?.businessName || 'Company', 375, footerTop + 263, { width: 125, align: 'center' })
    }

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename=Invoice-${invoice.invoiceNumber}.pdf`)
    doc.pipe(res)
    chunks.forEach((chunk, pageIndex) => {
        if (pageIndex > 0) doc.addPage({ size: 'A4', margin: 32 })
        drawWaveChrome(pageIndex + 1)
        if (pageIndex === 0) drawDetails()
        const y = drawTable(chunk, pageIndex === 0 ? 360 : 150)
        if (pageIndex === chunks.length - 1) drawFinalSections(y)
    })
    doc.end()
})
app.get('/api/settings', auth, async (req, res) => res.json(await Settings.findOne({ userId: req.user.id }) || {}))
app.put('/api/settings', auth, async (req, res) => { if (req.body.logoDataUrl && (!logoPattern.test(req.body.logoDataUrl) || Buffer.byteLength(req.body.logoDataUrl, 'utf8') > 1500000)) return res.status(400).json({ message: 'Logo must be a PNG, JPG, or WebP image under 1MB' }); if (req.body.qrDataUrl && (!logoPattern.test(req.body.qrDataUrl) || Buffer.byteLength(req.body.qrDataUrl, 'utf8') > 1500000)) return res.status(400).json({ message: 'Payment QR must be a PNG, JPG, or WebP image under 1MB' }); res.json(await Settings.findOneAndUpdate({ userId: req.user.id }, { ...req.body, userId: req.user.id }, { new: true, upsert: true, runValidators: true })) })
app.use(errorHandler)

const port = process.env.PORT || 5000
mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/ledgerly')
    .then(() => {
        console.log('MongoDB connected successfully')
        const server = app.listen(port, () => console.log(`Ledgerly API listening on ${port}`))
        server.on('error', (error) => {
            if (error.code === 'EADDRINUSE') {
                console.error(`Port ${port} is already in use. Stop the existing server or set a different PORT in backend/.env.`)
                process.exit(1)
            }

            console.error('Server failed to start:', error.message)
            process.exit(1)
        })
    })
    .catch((error) => { console.error('MongoDB connection failed:', error.message); process.exit(1) })
