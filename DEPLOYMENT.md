# 🚀 Hướng dẫn Deploy Understood (Hackathon 2026)

Ứng dụng gồm 2 phần:
- **Backend (NestJS + Socket.IO + Gemini AI)**: Port 3001
- **Frontend (React + Vite + Web Audio)**: Port 5173

---

## Cách 1: Deploy nhanh bằng Render (Khuyên dùng - Miễn phí & Hỗ trợ WebSocket 100%)

1. Đăng nhập [render.com](https://render.com) bằng GitHub.
2. Bấm **New +** ➡️ **Blueprint**.
3. Chọn repo `understood-adc-hackathon-2026`.
4. File `render.yaml` đã được thiết lập sẵn, Render sẽ tự động tạo 2 dịch vụ:
   - `understood-backend` (Web Service)
   - `understood-frontend` (Static Site)
5. Nhập biến môi trường `GEMINI_API_KEY` cho backend khi được nhắc ➡️ Bấm **Apply**.
6. Sau ~2 phút, bạn sẽ có 2 link hoạt động 24/7 trực tiếp!

---

## Cách 2: Deploy Frontend lên Vercel & Backend lên Railway / Render

### Bước A: Deploy Backend (Render hoặc Railway)
1. **Render**: Chọn **New Web Service** ➡️ chọn repo.
   - Root Directory: `server`
   - Build Command: `npm install && npm run build`
   - Start Command: `npm run start`
   - Environment Variable: `GEMINI_API_KEY` = `<your_key>`
2. Copy đường dẫn backend sau khi deploy (VD: `https://understood-backend.onrender.com`).

### Bước B: Deploy Frontend lên Vercel
1. Đăng nhập [vercel.com](https://vercel.com) ➡️ **Add New Project**.
2. Chọn repo `understood-adc-hackathon-2026`.
3. Framework Preset: **Vite**
4. Root Directory: `./`
5. Environment Variable:
   - `VITE_API_URL`: Điền URL backend ở Bước A (VD: `https://understood-backend.onrender.com`)
6. Bấm **Deploy** ➡️ Hoàn tất!

---

## Cách 3: Chạy Docker Production
```bash
# Build & Run backend
cd server
docker build -t understood-backend .
docker run -p 3001:3001 -e GEMINI_API_KEY=your_key understood-backend
```
