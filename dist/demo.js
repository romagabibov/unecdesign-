const taxonomy = [
  ["abstract", "Abstraksiya"], ["fashion", "Geyim"], ["sculpture", "Heykəltəraşlıq"],
  ["ceramics", "Keramika"], ["graphics", "Qrafika"], ["accessories", "Aksesuarlar"],
].map(([id, name], i) => ({ id, name, kind: "category", position: i, image: "./assets/work-" + i + ".webp" }));
taxonomy.push({ id: "studio", kind: "section", name: "Emalatxana seçimi", position: 0 }, { id: "edition", kind: "section", name: "Məhdud tiraj", position: 1 });
const products = [
  ["mavi-ritm", "Mavi ritm", "Leyla Həsənli", "abstract", "edition", 9500, 4, 328, "Kobalt rəngli kətanda qara fırça izləri. Ritm və hərəkəti bir kompozisiyada birləşdirən akril iş."],
  ["qirmizi-siluet", "Qırmızı siluet", "Aylin Məmmədova", "fashion", "studio", 14500, 2, 273, "Qatlanan yaxası və heykəltəraşlıqdan ilhamlanan biçimi ilə eksperimental gödəkçə."],
  ["forma-02", "Forma №02", "Murad Əliyev", "sculpture", "studio", 13500, 1, 186, "Qoz ağacından oyulmuş, işıq və kölgə ilə görünüşü dəyişən masaüstü heykəl."],
  ["torpaq-izi", "Torpaq izi", "Nərmin Quliyeva", "ceramics", "edition", 5200, 6, 245, "Əllə formalaşdırılmış, qabırğalı səthi olan krem rəngli dekorativ keramika vaza."],
  ["kesishme", "Kəsişmə", "Rəna Abbasova", "graphics", "edition", 3800, 8, 113, "Kağız üzərində kömür və qrafitlə hazırlanmış memarlıq perspektivi."],
  ["gumus-dalga", "Gümüş dalğa", "Nicat Kərimov", "accessories", "studio", 6800, 3, 154, "Mavi daş və qeyri-simmetrik metal forma ilə işlənmiş əl işi üzük."],
  ["forma-01", "Forma №01", "Murad Əliyev", "sculpture", "studio", 18000, 1, 302, "Əllə formalaşdırılmış tutqun keramika heykəli. Bir-birinə keçən səthlər əsərin baxış bucağına görə dəyişməsinə imkan verir."],
].map(([id, title, author, category, section, price, stock, views, description], i) => ({
  id, title, author, category, section, price, stock, views, description,
  image: i === 6 ? "./assets/hero.webp" : "./assets/work-" + i + ".webp",
  sellerUid: i === 2 || i === 6 ? "demo-student" : "demo-author-" + i,
  status: "published", publishedAt: Date.now() - (6 - i) * 86400000,
}));
const roles = { buyer: "Alıcı", student: "Tələbə", admin: "Administrator" };
const seed = { taxonomy, products, orders: [], reviews: [], messages: [], notifications: [], preferences: {}, seenViews: {} };
const key = "unec-dizayn-shop-demo-v1";
function read() {
  try { return JSON.parse(localStorage.getItem(key)) || structuredClone(seed); } catch { return structuredClone(seed); }
}
function persist(state) { localStorage.setItem(key, JSON.stringify(state)); }
const ordered = (list, sort) => list.sort((a,b) => sort === "popular" ? b.views - a.views : sort === "price-low" ? a.price - b.price : sort === "price-high" ? b.price - a.price : b.publishedAt - a.publishedAt);
export function makeDemo() {
  let user;
  try { user = JSON.parse(localStorage.getItem(key + "-user")); } catch { user = null; }
  let changed = () => {};
  const setUser = (role) => {
    user = role ? {uid:"demo-" + role, role, name:roles[role], email:role + "@demo.example"} : null;
    localStorage.setItem(key + "-user", JSON.stringify(user));
    changed(user);
  };
  const must = (role) => {
    if (!user || (role && user.role !== role)) throw Error("Bu əməliyyat üçün giriş tələb olunur.");
  };
  function notify(state, uid, title, message, link) {
    state.notifications.unshift({id:crypto.randomUUID(), uid, title, message, link, createdAt:Date.now()});
  }
  return {
    demo:true,
    watchAuth(callback) { changed = callback; callback(user); },
    setDemoRole:setUser,
    logout() { setUser(null); },
    async taxonomy() { return read().taxonomy; },
    async list(filters = {}, cursor = 0, size = 16) {
      const matching = read().products.filter(p => p.status === "published" && (!filters.category || p.category === filters.category) && (!filters.section || p.section === filters.section) && (!filters.q || [p.title,p.author,p.description].some(value => value.toLocaleLowerCase("az").includes(filters.q.toLocaleLowerCase("az")))));
      const sorted = ordered(matching, filters.sort);
      return {items:sorted.slice(cursor,cursor + size), cursor:cursor + size, more:sorted.length > cursor + size};
    },
    async product(id) { return read().products.find(p => p.id === id && p.status === "published") || null; },
    async reviews(id) { return read().reviews.filter(r => r.productId === id).slice(0,30); },
    async view(id) {
      const state = read();
      if (state.seenViews[id] === new Date().toISOString().slice(0,10)) return;
      const item = state.products.find(p => p.id === id && p.status === "published");
      if (item) { item.views++; state.seenViews[id] = new Date().toISOString().slice(0,10); persist(state); }
    },
    async contact(data) { const state=read(); state.messages.unshift({...data,id:crypto.randomUUID(),createdAt:Date.now()}); persist(state); },
    async account() {
      must();
      const state=read();
      const own=state.orders.filter(o => o.buyerUid === user.uid);
      const admin=user.role === "admin";
      return {orders:own, sales:user.role==="student" ? state.orders.flatMap(o => o.items.filter(i => i.sellerUid===user.uid).map(i => ({...i,id:o.id + i.productId,orderId:o.id,status:o.status,createdAt:o.createdAt}))) : [],
        works:state.products.filter(p => admin || p.sellerUid===user.uid), adminOrders:admin ? state.orders : [], messages:admin ? state.messages : [], prefs:state.preferences[user.uid] || {}};
    },
    async notices() {
      const state=read();
      const prefs=user ? state.preferences[user.uid] || {} : {};
      return {items:user ? state.notifications.filter(n => n.uid===user.uid) : [], prefs};
    },
    async preferences(patch) { must(); const state=read(); state.preferences[user.uid]={...state.preferences[user.uid],...patch,...(patch.seen?{seenAt:Date.now()}:{})}; persist(state); },
    async checkout({items, name, phone, requestId}) {
      must();
      const state=read();
      const existing=state.orders.find(o => o.requestId===requestId && o.buyerUid===user.uid);
      if (existing) return {id:existing.id};
      const rows=items.map(({productId,qty}) => {
        const p=state.products.find(x => x.id===productId && x.status==="published");
        if (!p || p.stock<qty) throw Error("Səbətdəki işlərdən birinin sayı kifayət deyil.");
        p.stock-=qty;
        return {productId,qty,title:p.title,image:p.image,price:p.price,sellerUid:p.sellerUid};
      });
      const id=crypto.randomUUID(), createdAt=Date.now();
      state.orders.unshift({id,requestId,items:rows,name,phone,buyerUid:user.uid,total:rows.reduce((sum,i)=>sum+i.price*i.qty,0),status:"paid",createdAt});
      notify(state,user.uid,"Sınaq ödənişi tamamlandı","Sifarişin kabinetdə görünür.","#account/orders");
      for (const uid of new Set(rows.map(i=>i.sellerUid))) notify(state,uid,"Yeni satış","İşlərindən biri sifariş edilib.","#account/sales");
      persist(state);
      return {id};
    },
    async review(data) {
      must();
      const state=read();
      const allowed=state.orders.some(o=>o.buyerUid===user.uid && o.status==="completed" && o.items.some(i=>i.productId===data.productId));
      if (!allowed) throw Error("Rəy yalnız tamamlanmış alışdan sonra yazıla bilər.");
      state.reviews=state.reviews.filter(r=>r.uid!==user.uid || r.productId!==data.productId);
      state.reviews.unshift({...data,author:user.name,uid:user.uid,createdAt:Date.now()});
      persist(state);
    },
    async saveWork(data, file) {
      must();
      if (!["student","admin"].includes(user.role)) throw Error("İcazə yoxdur.");
      const state=read(), previous=state.products.find(p=>p.id===data.id);
      if (previous && user.role!=="admin" && (previous.sellerUid!==user.uid || previous.status==="published")) throw Error("Bu işi dəyişmək üçün icazən yoxdur.");
      let image=previous?.image;
      if (file?.size) {
        if (file.size > 2 * 1024 * 1024) throw Error("Demo rejimində şəkil 2 MB-dan kiçik olmalıdır.");
        image=await new Promise((resolve,reject)=>{const reader=new FileReader(); reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});
      }
      if (!image) throw Error("İşin şəklini əlavə et.");
      const item={...previous,...data,image,status:user.role==="admin"?data.status:"pending",sellerUid:previous?.sellerUid || data.sellerUid || user.uid,views:previous?.views || 0};
      if (item.status==="published" && previous?.status!=="published") item.publishedAt=Date.now();
      state.products=state.products.filter(p=>p.id!==item.id);
      state.products.push(item);
      if (previous && previous.status!==item.status) notify(state,item.sellerUid,"İşin statusu dəyişdi",item.title,"#account/works");
      persist(state);
    },
    async saveTaxonomy(data) {
      must("admin");
      const state=read(), previous=state.taxonomy.find(t=>t.id===data.id);
      state.taxonomy=state.taxonomy.filter(t=>t.id!==data.id);
      state.taxonomy.push({...previous,...data});
      persist(state);
    },
    async advanceOrder(id,status) {
      must("admin");
      const state=read(), order=state.orders.find(o=>o.id===id);
      if (!order || !((order.status==="paid" && status==="ready") || (order.status==="ready" && status==="completed"))) throw Error("Status keçidi mümkün deyil.");
      order.status=status;
      notify(state,order.buyerUid,"Sifarişin statusu dəyişdi",status==="ready"?"Sifariş təhvilə hazırdır.":"Sifariş tamamlandı.","#account/orders");
      for (const uid of new Set(order.items.map(i=>i.sellerUid))) notify(state,uid,"Satışın statusu dəyişdi",status==="ready"?"Sifariş təhvilə hazırdır.":"Sifariş tamamlandı.","#account/sales");
      persist(state);
    },
  };
}
