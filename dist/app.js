const {default:EmblaCarousel}=await import("./vendor/embla-carousel.js").catch(()=>({}));
const [{config},{makeDemo}]=await Promise.all([import("./config.js"),import("./demo.js")]);
const $=id=>document.getElementById(id);
const svg=name=>`<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const safe=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
const path=id=>encodeURIComponent(id);
const date=ms=>ms ? new Intl.DateTimeFormat("az-AZ",{day:"2-digit",month:"2-digit",year:"numeric",timeZone:"Asia/Baku"}).format(ms) : "";
const money=cents=>new Intl.NumberFormat("az",{maximumFractionDigits:2,minimumFractionDigits:cents%100?2:0}).format(cents/100)+" ₼";
const statuses={published:"Satışda",pending:"Yoxlamada",draft:"Qaralama",archived:"Arxivdə",paid:"Ödənilib",ready:"Təhvilə hazır",completed:"Tamamlanıb",payment_pending:"Ödəniş gözlənilir",payment_failed:"Ödəniş alınmadı",payment_review:"Ödəniş yoxlanılır",refunded:"Geri qaytarılıb"};
const fallbackImage="./assets/hero.webp";
const errorText=error=> {
  if (error.code==="auth/invalid-credential" || error.code==="auth/wrong-password") return "E-poçt və ya şifrə yanlışdır.";
  if (error.code==="auth/email-already-in-use") return "Bu e-poçt artıq qeydiyyatdan keçib.";
  if (error.code==="permission-denied" || error.code==="functions/permission-denied") return "Bu əməliyyat üçün icazən yoxdur.";
  return error.message && !["internal","INTERNAL"].includes(error.message) ? error.message : "Əməliyyat alınmadı. Yenidən cəhd et.";
};
function fromStore(key,fallback) { try {return JSON.parse(localStorage.getItem(key))??fallback;} catch {return fallback;} }
function toStore(key,value) { try {localStorage.setItem(key,JSON.stringify(value));} catch {} }
function img(src,title="") {
  const good=/^(?:\.\/assets\/[a-z0-9.-]+|https:\/\/firebasestorage\.googleapis\.com\/[^ ]+|https:\/\/storage\.googleapis\.com\/[^ ]+|http:\/\/127\.0\.0\.1:9199\/[^ ]+|data:image\/(?:png|jpeg|webp|avif);base64,[A-Za-z0-9+/=]+)$/i.test(src||"");
  return `<img src="${safe(good?src:fallbackImage)}" alt="${safe(title)}" loading="lazy" decoding="async">`;
}
const modeLabel=$("mode-label");
const data={api:null,user:null,authReady:false,taxonomy:[],latest:[],arrivals:null,unsubscribeNotices:null,cart:fromStore("unec-cart",[]),notices:[],prefs:{},interest:fromStore("unec-interest",{}),routeId:0,catalog:{},product:null,seen:fromStore("unec-seen-work",{}),searchTimer:null,toastTimer:null,panel:null,checkoutId:null};
let resolveReady;
const ready=new Promise(resolve=>{resolveReady=resolve;});
const cat=(id,kind="category")=>data.taxonomy.find(t=>t.id===id&&t.kind===kind)?.name||"";
const options=(kind,selected="",empty="")=>`${empty?`<option value="">${safe(empty)}</option>`:""}${data.taxonomy.filter(t=>t.kind===kind).sort((a,b)=>a.position-b.position).map(t=>`<option value="${safe(t.id)}" ${t.id===selected?"selected":""}>${safe(t.name)}</option>`).join("")}`;
const tag=text=>`<span class="tag">${safe(text)}</span>`;
const empty=text=>`<p class="empty">${safe(text)}</p>`;
const button=(text,action,css="outline",extra="")=>`<button type="button" class="button ${css}" data-action="${action}" ${extra}>${text}</button>`;
const accountLink=(text,tab)=>`<a class="button outline" href="#account/${tab}">${safe(text)} ${svg("right")}</a>`;
const current=()=>location.hash.slice(1)||"home";
const to=url=>{ if (location.hash===url) route(); else location.hash=url; };
function toast(message) {
  clearTimeout(data.toastTimer);
  $("toast").textContent=message; $("toast").hidden=false;
  data.toastTimer=setTimeout(()=>{$("toast").hidden=true;},3400);
}
function formBusy(form,busy) {
  const submit=form.querySelector('[type="submit"]');
  if (submit) submit.disabled=busy;
  form.setAttribute("aria-busy",busy?"true":"false");
}
function formStatus(form,message,isError=false) {
  const target=form.querySelector(".form-status");
  if (target) {target.textContent=message;target.classList.toggle("error",isError);}
  else if (message) toast(message);
}
function card(p) {
  return `<article class="product-card"><a href="#product/${path(p.id)}"><span class="product-photo">${img(p.image)}</span><div class="product-body"><span class="meta product-label">${safe(p.stock>0?cat(p.category)||"İş":"Satılıb")}</span><h3>${safe(p.title)}</h3><p>${safe(p.author)}</p><div class="product-meta"><b>${money(p.price)}</b><span>${svg("eye")} ${Number(p.views)||0}</span></div></div></a></article>`;
}
let categoryItems=[];
let categoryIndex=0;
let popularGallery=null;
const reducedMotion=matchMedia("(prefers-reduced-motion: reduce)");
const surpriseSeen=new Set();

function selectCategory(index) {
  if (!categoryItems.length) return;
  categoryIndex=(index+categoryItems.length)%categoryItems.length;
  const item=categoryItems[categoryIndex];
  const target=`#catalog?category=${path(item.id)}`;
  const art=$("category-art");
  $("category-stage").dataset.shape=String(categoryIndex%3);
  art.innerHTML=item.image?img(item.image):`<div class="category-placeholder" aria-hidden="true">${svg("spark")}</div>`;
  $("category-preview").href=target;
  $("category-preview-link").href=target;
  $("category-preview-link").setAttribute("aria-label",`${item.name} kateqoriyasına bax`);
  $("category-count").textContent=`${String(categoryIndex+1).padStart(2,"0")} / ${String(categoryItems.length).padStart(2,"0")}`;
  $("home-categories").querySelectorAll(".category-card").forEach((link,i)=>link.classList.toggle("active",i===categoryIndex));
}
function renderTaxonomy() {
  const previous=categoryItems[categoryIndex]?.id;
  categoryItems=data.taxonomy.filter(t=>t.kind==="category").sort((a,b)=>a.position-b.position);
  $("home-categories").innerHTML=categoryItems.map((t,i)=>`<a class="category-card" data-preview="${i}" href="#catalog?category=${path(t.id)}"><span class="cat-num" aria-hidden="true">${String(i+1).padStart(2,"0")} /</span><span class="cat-label">${safe(t.name)}</span><span class="cat-arrow">${svg("up-right")}</span></a>`).join("")||empty("Kateqoriyalar tezliklə əlavə olunacaq.");
  $("category-stage").hidden=!categoryItems.length;
  $("category-stage").querySelector(".category-arrows").hidden=categoryItems.length<2;
  selectCategory(Math.max(0,categoryItems.findIndex(t=>t.id===previous)));
}
function paintPopularControls() {
  if (!popularGallery) return;
  const stops=popularGallery.scrollSnapList();
  const current=popularGallery.selectedScrollSnap();
  $("popular-controls").hidden=stops.length<2;
  $("popular-count").textContent=`${String(current+1).padStart(2,"0")} / ${String(stops.length).padStart(2,"0")}`;
  $("popular-progress").style.setProperty("--gallery-progress",(current+1)/stops.length);
  document.querySelector('[data-action="gallery-prev"]').disabled=!popularGallery.canScrollPrev();
  document.querySelector('[data-action="gallery-next"]').disabled=!popularGallery.canScrollNext();
}
function renderPopular(items,message) {
  popularGallery?.destroy();
  popularGallery=null;
  const viewport=$("popular-viewport");
  viewport.classList.remove("has-embla");
  $("popular-controls").hidden=true;
  $("home-products").innerHTML=items.map(card).join("")||empty(message);
  if (items.length<2 || !EmblaCarousel) return;
  popularGallery=EmblaCarousel(viewport,{
    align:"start", containScroll:"trimSnaps", dragFree:false,
    breakpoints:{"(prefers-reduced-motion: reduce)":{duration:0}},
  });
  viewport.classList.add("has-embla");
  popularGallery.on("select",paintPopularControls).on("reInit",paintPopularControls);
  paintPopularControls();
}
function surpriseWork() {
  const works=data.latest.filter(p=>p.id!==data.product?.id&&p.stock>0);
  if (!works.length) return to("#catalog");
  let choices=works.filter(p=>!surpriseSeen.has(p.id));
  if (!choices.length) {
    const last=[...surpriseSeen].at(-1);
    surpriseSeen.clear();
    choices=works.length>1?works.filter(p=>p.id!==last):works;
  }
  const choice=choices[Math.floor(Math.random()*choices.length)];
  surpriseSeen.add(choice.id);
  to(`#product/${path(choice.id)}`);
}
$("home-categories").addEventListener("pointerover",event=>{
  const link=event.target.closest("[data-preview]");
  if (link && event.pointerType!=="touch" && Number(link.dataset.preview)!==categoryIndex) selectCategory(Number(link.dataset.preview));
});
$("home-categories").addEventListener("focusin",event=>{
  const link=event.target.closest("[data-preview]");
  if (link && Number(link.dataset.preview)!==categoryIndex) selectCategory(Number(link.dataset.preview));
});
$("popular-viewport").addEventListener("keydown",event=>{
  if (!popularGallery||event.target!==event.currentTarget) return;
  if (event.key==="ArrowRight"||event.key==="ArrowLeft") {
    event.preventDefault();
    if (event.key==="ArrowRight") popularGallery.scrollNext(reducedMotion.matches);
    else popularGallery.scrollPrev(reducedMotion.matches);
  }
});
const visual=document.querySelector(".hero-visual");
visual.addEventListener("pointermove",event=>{
  if (reducedMotion.matches||event.pointerType!=="mouse") return;
  const box=visual.getBoundingClientRect();
  visual.style.setProperty("--art-x",((event.clientX-box.left)/box.width-.5)*15+"px");
  visual.style.setProperty("--art-y",((event.clientY-box.top)/box.height-.5)*15+"px");
});
visual.addEventListener("pointerleave",()=>{
  visual.style.removeProperty("--art-x");
  visual.style.removeProperty("--art-y");
});
async function refreshHome() {
  const results=await Promise.allSettled([data.api.taxonomy(),data.api.list({sort:"popular"},undefined,8),data.api.list({sort:"new"},undefined,12)]);
  if (results[0].status==="fulfilled") {data.taxonomy=results[0].value;renderTaxonomy();}
  else $("home-categories").innerHTML=empty("Kateqoriyaları yükləmək mümkün olmadı.");
  if (results[1].status==="fulfilled") renderPopular(results[1].value.items,"Satışa çıxarılan işlər burada görünəcək.");
  else renderPopular([],"İşləri yükləmək mümkün olmadı.");
  if (results[2].status==="fulfilled") data.latest=results[2].value.items;
  if (!data.api.demo) {
    const featured=data.latest[0], hero=$("hero-product");
    hero.href=featured?`#product/${path(featured.id)}`:"#catalog";
    hero.setAttribute("aria-label",featured?`${featured.title} işinə bax`:"Mağazaya bax");
    document.querySelector(".hero-visual-bottom strong").textContent="Dizayn vitrini";
    document.querySelector(".hero-visual-top span").textContent="KONSEPT / 001";
  }
  updateNoticeDot();
}
function panel(name,title,content) {
  data.panel=name; $("panel").classList.toggle("is-art",name==="art");
  $("drawer-title").textContent=title; $("drawer-content").innerHTML=content;
  if (!$("panel").open) $("panel").showModal();
}
function closePanel() { if ($("panel").open) $("panel").close(); }
function paintCartCount() {
  const count=data.cart.reduce((sum,item)=>sum+item.qty,0);
  $("cart-count").textContent=count;
  document.querySelector(".cart-button").setAttribute("aria-label",`Səbət, ${count} məhsul`);
}
function saveCart() {toStore("unec-cart",data.cart);data.checkoutId=null;paintCartCount();}
function cartChange(id,delta) {
  const item=data.cart.find(i=>i.productId===id);
  if (item) {
    if (delta>0 && item.qty>=Math.min(item.stock,20)) return toast("Mövcud say həddinə çatdın.");
    item.qty+=delta;
    if (item.qty<1) data.cart=data.cart.filter(i=>i!==item);
  } else {
    const p=data.product;
    if (!p || p.id!==id || p.stock<1 || delta<1) return;
    if (data.cart.length>=20) return toast("Səbətə ən çox 20 fərqli iş əlavə etmək olar.");
    data.cart.push({productId:p.id,qty:1,title:p.title,image:p.image,stock:p.stock,price:p.price});
  }
  saveCart();
  if (data.panel==="cart") showCart();
}
function showCart() {
  const total=data.cart.reduce((sum,i)=>sum+i.qty*i.price,0);
  panel("cart","Səbət",data.cart.length?`<div class="drawer-stack">${data.cart.map(i=>`<div class="entry"><div class="inline-image">${img(i.image)}<div><strong>${safe(i.title)}</strong><p>${money(i.price)}</p></div></div><div class="qty"><button type="button" data-action="cart-minus" data-id="${safe(i.productId)}" aria-label="Bir ədəd çıxar">${svg("minus")}</button><span>${i.qty}</span><button type="button" data-action="cart-plus" data-id="${safe(i.productId)}" aria-label="Bir ədəd əlavə et">${svg("plus")}</button></div></div>`).join("")}</div><div class="drawer-total"><span>Cəmi</span><span>${money(total)}</span></div>${button("Sifarişi rəsmiləşdir "+svg("right"),"checkout","hot wide-button")}`:`${empty("Səbət hələ boşdur.")}<p><a class="button dark" href="#catalog" data-action="close">Mağazaya keç ${svg("right")}</a></p>`);
}
function showCheckout() {
  if (!data.user) {
    closePanel();to("#account/signin?next=checkout");return;
  }
  if (!data.cart.length) return showCart();
  const total=data.cart.reduce((sum,i)=>sum+i.price*i.qty,0);
  panel("checkout","Sifariş",`<p class="status-note">${data.api.demo?"Bu sınaq sifarişidir. Ödəniş simulyasiya edilir.":"Sifariş təhvil məntəqəsindən götürülür. Ödəniş üçün Epoint-in səhifəsinə keçəcəksən."}</p><form class="form-grid" id="checkout-form"><label class="span-2">Ad və soyad<input name="name" required minlength="2" maxlength="80" autocomplete="name" value="${safe(data.user.name.includes("@")?"":data.user.name)}"></label><label class="span-2">Əlaqə telefonu<input type="tel" name="phone" required minlength="7" maxlength="30" autocomplete="tel" placeholder="+994 XX XXX XX XX"></label><div class="drawer-total span-2"><span>Cəmi</span><span>${money(total)}</span></div><button class="button hot span-2" type="submit">${data.api.demo?"Sınaq ödənişini təsdiqlə":"Epoint ilə ödə"} ${svg("up-right")}</button><p class="form-status span-2" role="status"></p></form>`);
}
function notificationList() {
  const feed=data.prefs.arrivals===false?[]:(data.arrivals||data.latest).slice(0,5).map(p=>({title:`Yeni iş · ${p.title}`,message:p.author,link:`#product/${path(p.id)}`,createdAt:p.publishedAt}));
  const entries=[...data.notices,...feed].sort((a,b)=>b.createdAt-a.createdAt);
  return entries.length?entries.map(n=>`<article class="notice ${n.createdAt>(data.prefs.seenAt||0)?"new":""}"><strong>${safe(n.title)}</strong><p>${safe(n.message)}</p><small class="muted">${date(n.createdAt)}</small> ${n.link?`<a class="text-link" href="${safe(n.link)}" data-action="close">Bax ${svg("right")}</a>`:""}</article>`).join(""):empty("Hazırda bildiriş yoxdur.");
}
function updateNoticeDot() {
  const latest=data.prefs.arrivals===false?0:(data.arrivals||data.latest)[0]?.publishedAt||0;
  $("notification-dot").hidden=!data.user||Math.max(latest,data.notices[0]?.createdAt||0)<=(data.prefs.seenAt||0);
}
async function refreshNotices() {
  const user=data.user;
  const results=await data.api.notices(user);
  if (data.user?.uid!==user?.uid) return;
  data.notices=results.items;data.prefs=results.prefs;updateNoticeDot();
}
function showNotices() {
  panel("notifications","Bildirişlər",`<div class="drawer-stack">${notificationList()}${data.user?`${button("Oxunmuş kimi işarələ","mark-read")}${accountLink("Bildiriş ayarları","notifications")}`:accountLink("Kabinetə daxil ol","signin")}</div>`);
}
function filterValues(route) {
  const params=new URLSearchParams(route.split("?")[1]);
  return {category:params.get("category")||"",section:params.get("section")||"",sort:params.get("sort")||"new",q:(params.get("q")||"").slice(0,80)};
}
function setFilters(patch,replace=false) {
  const params=new URLSearchParams(Object.entries({...filterValues(current()),...patch}).filter(([,value])=>value));
  const url="#catalog?"+params;
  if (replace) {history.replaceState(null,"",url);route(true);}
  else to(url);
}
function catalogFilters(filters) {
  $("section-filter").innerHTML=options("section",filters.section,"Bütün kolleksiyalar");
  $("catalog-sort").value=filters.sort;
  if (document.activeElement!==$("catalog-search")) $("catalog-search").value=filters.q;
  const items=[{id:"",name:"Hamısı"},...data.taxonomy.filter(t=>t.kind==="category").sort((a,b)=>a.position-b.position)];
  $("category-filters").innerHTML=items.map(t=>`<button class="chip ${t.id===filters.category?"active":""}" aria-pressed="${t.id===filters.category}" data-action="category" data-id="${safe(t.id)}">${safe(t.name)}</button>`).join("");
}
async function loadCatalog(filters,routeId,append=false) {
  if (append&&data.catalog.loading) return;
  if (!append) {
    data.catalog={filters,items:[],cursor:undefined,more:false};catalogFilters(filters);
    $("catalog-products").innerHTML=empty("İşlər yüklənir…");$("catalog-count").textContent="";$("catalog-more").hidden=true;
  }
  const entry=data.catalog; entry.loading=true;$("catalog-more").disabled=true;
  try {
    let result;
    const passes=filters.q ? 5 : 1;
    for (let i=0;i<passes;i++) {
      result=await data.api.list(filters,entry.cursor,filters.q?30:16);
      if (routeId!==data.routeId) return;
      entry.items.push(...result.items.filter(p=>!entry.items.some(old=>old.id===p.id)));entry.cursor=result.cursor;
      if (!result.more||result.items.length>=8) break;
    }
    entry.more=result.more;
    $("catalog-products").innerHTML=entry.items.map(card).join("")||empty(entry.more?"Bu hissədə uyğun iş tapılmadı. Daha çox işə bax.":"Uyğun iş tapılmadı.");
    $("catalog-count").textContent=`${entry.items.length} iş göstərilir`;
    $("catalog-more").hidden=!entry.more;
  } catch (error) {if(routeId===data.routeId)$("catalog-products").innerHTML=empty(errorText(error));}
  finally {entry.loading=false;$("catalog-more").disabled=false;}
}
function reviewList(list) {
  return list.length?list.map(r=>`<article class="review"><strong>${safe(r.author)}</strong> <span class="stars" aria-label="${r.rating} / 5">${"★".repeat(Math.min(5,Math.max(0,Number(r.rating)||0)))}</span><p>${safe(r.text)}</p><small class="muted">${date(r.createdAt)}</small></article>`).join(""):empty("Hələ rəy yoxdur.");
}
function reviewForm() {
  return data.user?`<form class="form-grid surface" id="review-form"><label class="span-2">Qiymət<select name="rating"><option value="5">5 ★</option><option value="4">4 ★</option><option value="3">3 ★</option><option value="2">2 ★</option><option value="1">1 ★</option></select></label><label class="span-2">Rəyin<textarea name="text" rows="3" required minlength="5" maxlength="600"></textarea></label><button class="button dark" type="submit">Rəyi göndər ${svg("up-right")}</button><p class="form-status span-2" role="status">Rəy tamamlanmış alışdan sonra yazıla bilər.</p></form>`:`<div class="surface"><p class="muted">Rəy yazmaq üçün kabinetə daxil ol.</p>${accountLink("Daxil ol","signin")}</div>`;
}
async function productPage(id,routeId) {
  const page=$("product-page");page.innerHTML=empty("İş yüklənir…");
  const p=await data.api.product(id);
  if (routeId!==data.routeId) return;
  if (!p) {page.innerHTML=empty("İş tapılmadı.")+`<p><a class="text-link" href="#catalog">Mağazaya qayıt ${svg("right")}</a></p>`;return;}
  data.product=p;
  if (!data.interest[p.category]) data.interest[p.category]=0;
  const today=new Date().toISOString().slice(0,10);
  if (data.seen[p.id]!==today) {
    data.api.view(p.id).catch(()=>{});
    data.interest[p.category]++;data.seen[p.id]=today;
    data.seen=Object.fromEntries(Object.entries(data.seen).filter(([,d])=>d===today));
    toStore("unec-interest",data.interest);toStore("unec-seen-work",data.seen);
  }
  page.innerHTML=`<a class="text-link back" href="#catalog">← Mağaza</a><div class="product-detail"><button class="product-detail-photo" type="button" data-action="art-preview" aria-label="Şəkli böyüt">${img(p.image,p.title)}<span class="zoom-control">${svg("expand")}</span></button><div><div class="detail-meta">${tag(cat(p.category)||"Tələbə işi")}${cat(p.section,"section")?tag(cat(p.section,"section")):""}<span>${svg("eye")} ${Number(p.views)||0}</span></div><h1>${safe(p.title)}</h1><p class="muted">Müəllif · ${safe(p.author)}</p><p class="page-lead">${safe(p.description)}</p><p class="price">${money(p.price)}</p><p class="muted">${p.stock>0?`Mövcuddur · ${p.stock} ədəd`:"Satılıb"}</p>${p.stock>0?button("Səbətə əlavə et "+svg("bag"),"add-cart","hot"):""}</div></div>
  <section class="subsection"><h2>Rəylər</h2><div class="review-grid"><div class="review-list" id="product-reviews">${empty("Rəylər yüklənir…")}</div><div id="review-form-slot">${reviewForm()}</div></div></section>
  <section class="subsection"><div class="related-head"><h2>Sənə uyğun ola bilər</h2><button class="hero-secondary" type="button" data-action="surprise">${svg("spark")} Sürpriz əsər</button></div><div class="product-grid" id="related-products"></div></section>`;
  const favorite=Object.entries(data.interest).sort((a,b)=>b[1]-a[1])[0]?.[0];
  const [reviews,related]=await Promise.allSettled([data.api.reviews(id),data.api.list({category:p.category,sort:"popular"},undefined,6)]);
  if (routeId!==data.routeId) return;
  $("product-reviews").innerHTML=reviews.status==="fulfilled"?reviewList(reviews.value):empty("Rəyləri yükləmək mümkün olmadı.");
  let suggestions=related.status==="fulfilled"?related.value.items:[];
  if (suggestions.filter(q=>q.id!==id).length<4 && favorite && favorite!==p.category) {
    try {suggestions=suggestions.concat((await data.api.list({category:favorite,sort:"popular"},undefined,5)).items);} catch {}
  }
  if (routeId!==data.routeId) return;
  const items=[...new Map([...suggestions,...data.latest].filter(q=>q.id!==id&&q.stock>0).map(q=>[q.id,q])).values()].slice(0,4);
  $("related-products").innerHTML=items.map(card).join("")||empty("Yeni tövsiyələr tezliklə görünəcək.");
}
function authMarkup(type,next) {
  const signup=type==="signup",reset=type==="reset";
  if (data.api.demo) return `<div class="surface auth-surface"><h2>Demo hesabı</h2><p class="muted">Rolu seç və mağazanı sına. Dəyişikliklər bu brauzerdə saxlanılır.</p><div class="chips">${["buyer","student","admin"].map((r,i)=>button(["Alıcı","Tələbə","Administrator"][i],"demo-role","outline",`data-id="${r}" data-next="${safe(next)}"`)).join("")}</div></div>`;
  return `<div class="surface auth-surface"><h2>${reset?"Şifrəni bərpa et":signup?"Qeydiyyatdan keç":"Daxil ol"}</h2><form class="form-grid" id="auth-form" data-type="${type}" data-next="${safe(next)}">${signup?'<label class="span-2">Ad və soyad<input name="name" required minlength="2" maxlength="80" autocomplete="name"></label>':""}<label class="span-2">E-poçt<input name="email" type="email" required maxlength="120" autocomplete="email"></label>${reset?"":`<label class="span-2">Şifrə<input name="password" type="password" required minlength="8" maxlength="100" autocomplete="${signup?"new-password":"current-password"}"></label>`}<button class="button dark" type="submit">${reset?"Link göndər":signup?"Hesab yarat":"Daxil ol"}</button><p class="form-status span-2" role="status"></p></form><p class="muted">${["signin","signup","reset"].filter(t=>t!==type).map(t=>`<a class="text-link" href="#account/${t}${next?"?next="+path(next):""}">${{signin:"Daxil ol",signup:"Hesab yarat",reset:"Şifrəni unutdum"}[t]}</a>`).join(" &nbsp; ")}</p></div>`;
}
function orderMarkup(o,admin=false) {
  const next={paid:"ready",ready:"completed"}[o.status];
  return `<article class="entry"><div><strong>#${safe(o.id.slice(0,9))} · ${money(o.total)}</strong><p>${o.items.map(i=>`${safe(i.title)} × ${i.qty}`).join(" · ")}</p><small class="muted">${date(o.createdAt)}${admin?` · ${safe(o.name)} · ${safe(o.phone)}`:""}</small></div><div class="entry-actions">${tag(statuses[o.status]||o.status)}${admin&&next?button(next==="ready"?"Təhvilə hazır":"Tamamla","advance-order","outline",`data-id="${safe(o.id)}" data-status="${next}"`):""}${o.status==="payment_pending" && !data.api.demo ? button(admin?"Ödənişi yoxla":"Ödənişə qayıt","resume-pay","outline",`data-id="${safe(o.id)}" ${admin?'data-admin="true"':""}`):""}</div></article>`;
}
function workForm(p={},admin=false) {
  const suffix=p.id?"-"+p.id:"";
  return `<form class="form-grid" data-form="work" data-id="${safe(p.id||"")}" data-stock="${p.stock??1}"><label>İşin adı<input name="title" required minlength="2" maxlength="90" value="${safe(p.title)}"></label><label>Müəllif<input name="author" required minlength="2" maxlength="80" value="${safe(p.author||(!admin&&!data.api.demo&&!data.user.name.includes("@")?data.user.name:""))}"></label><label>Kateqoriya<select name="category" required>${options("category",p.category,"Seç")}</select></label><label>Kolleksiya<select name="section">${options("section",p.section,"Kolleksiyasız")}</select></label><label>Qiymət (₼)<input name="price" type="number" min="0.01" max="100000" step="0.01" required value="${p.price?p.price/100:""}"></label><label>Mövcud say<input name="stock" type="number" min="0" max="1000" step="1" required value="${p.stock??1}"></label>${admin?`<label>Status<select name="status">${["draft","pending","published","archived"].map(v=>`<option value="${v}" ${p.status===v?"selected":""}>${statuses[v]}</option>`).join("")}</select></label>${!p.id?'<label>Tələbənin hesab ID-si (istəyə bağlı)<input name="sellerUid" maxlength="128"></label>':""}`:""}<label class="span-2">Təsvir<textarea name="description" minlength="5" maxlength="2000" required rows="3">${safe(p.description)}</textarea></label><label class="span-2" for="image${safe(suffix)}">Şəkil ${p.id?"(dəyişmək üçün)":""}<input id="image${safe(suffix)}" type="file" name="image" accept="image/jpeg,image/png,image/webp,image/avif" ${p.id?"":"required"}></label><button class="button dark" type="submit">${admin?"Yadda saxla":"Yoxlamaya göndər"} ${svg("up-right")}</button><p class="form-status span-2" role="status"></p></form>`;
}
function taxonomyForm(item={}) {
  return `<form class="form-grid" data-form="taxonomy" data-id="${safe(item.id||"")}"><label>Ad<input name="name" required minlength="2" maxlength="40" value="${safe(item.name)}"></label>${item.id?"":`<label>Növ<select name="kind"><option value="category">Kateqoriya</option><option value="section">Kolleksiya</option></select></label>`}<label>Sıra<input name="position" type="number" min="0" max="999" required value="${item.position??10}"></label><button class="button dark" type="submit">Yadda saxla</button><p class="form-status span-2" role="status"></p></form>`;
}
async function accountPage(tab,params,routeId) {
  const page=$("account-page"),user=data.user;
  if (!data.authReady) {page.innerHTML=empty("Kabinet yüklənir…");return;}
  if (!user) {
    page.innerHTML=`<p class="eyebrow"><b>04</b><span></span> KABİNET</p><h1>Şəxsi kabinet</h1><p class="page-lead">Sifarişlər, bildirişlər və tələbə işləri bir yerdə.</p>${authMarkup(["signup","reset"].includes(tab)?tab:"signin",params.get("next")==="checkout"?"checkout":"")}`;
    return;
  }
  if (params.get("next")==="checkout") {to("#account/orders");showCheckout();return;}
  const admin=user.role==="admin",student=user.role==="student";
  const tabs=[["orders","Sifarişlərim"],["notifications","Bildirişlər"],...(student?[["works","İşlərim"],["sales","Satışlarım"]]:[]),...(admin?[["works","Lotlar"],["taxonomy","Kateqoriyalar və kolleksiyalar"],["admin-orders","Bütün sifarişlər"],["questions","Mesajlar"]]:[])];
  if (!tabs.some(([id])=>id===tab)) tab="orders";
  page.innerHTML=`<p class="eyebrow"><b>04</b><span></span> ${admin?"İDARƏETMƏ":student?"TƏLƏBƏ KABİNETİ":"KABİNET"}</p><div class="account-top"><div><h1>Şəxsi kabinet</h1><p class="page-lead">${safe(user.name)}${student?` · Hesab ID-si ${safe(user.uid)}`:""}</p></div><div>${button("Çıxış","logout")}</div></div>${data.api.demo?`<div class="demo-box"><p>Demo rolu · ${safe(user.name)}</p><div class="chips">${["buyer","student","admin"].filter(r=>r!==user.role).map(r=>button({buyer:"Alıcıya keç",student:"Tələbəyə keç",admin:"Adminə keç"}[r],"demo-role","outline",`data-id="${r}"`)).join("")}</div></div>`:""}<nav class="chips account-tools" aria-label="Kabinet menyusu">${tabs.map(([id,label])=>`<a class="chip ${id===tab?"active":""}" ${id===tab?'aria-current="page"':""} href="#account/${id}">${label}</a>`).join("")}</nav><div class="account-body" id="account-content">${empty("Məlumat yüklənir…")}</div>`;
  if (tab==="taxonomy") {
    $("account-content").innerHTML=`<details open><summary>Yeni kateqoriya və ya kolleksiya</summary>${taxonomyForm()}</details>${data.taxonomy.map(t=>`<details><summary>${safe(t.name)} · ${t.kind==="category"?"Kateqoriya":"Kolleksiya"}</summary>${taxonomyForm(t)}</details>`).join("")}`;return;
  }
  if (tab==="notifications") {
    await refreshNotices();
    if (routeId!==data.routeId) return;
    $("account-content").innerHTML=`<label class="toggle-line surface"><input type="checkbox" id="arrival-pref" ${data.prefs.arrivals!==false?"checked":""}> Yeni işlər haqqında bildirişlər</label>${button("Oxunmuş kimi işarələ","mark-read")}${notificationList()}`;return;
  }
  if (params.has("payment")) {
    const id=params.get("order");
    if (id&&!data.api.demo) await data.api.resolvePayment(id).catch(()=>{});
    if (routeId!==data.routeId) return;
  }
  const model=await data.api.account(user);
  if (routeId!==data.routeId) return;
  const content=$("account-content");
  if (tab==="orders" || tab==="admin-orders") {
    const items=tab==="orders"?model.orders:model.adminOrders;
    content.innerHTML=(params.has("payment")?`<p class="status-note">Ödənişin statusu Epoint tərəfindən təsdiqləndikdən sonra yenilənir. ${button("Yenilə","refresh-account")}</p>`:"")+(items.map(o=>orderMarkup(o,tab==="admin-orders")).join("")||empty("Sifariş yoxdur."));
  } else if (tab==="works") {
    content.innerHTML=`<details open><summary>${admin?"Yeni lot":"Yeni iş göndər"}</summary>${workForm({},admin)}</details>`+model.works.map(p=>`<details><summary>${safe(p.title)} · ${statuses[p.status]||safe(p.status)} · ${p.stock} ədəd</summary>${admin||p.status!=="published"?workForm(p,admin):`<p>${safe(p.description)}</p><a class="text-link" href="#product/${path(p.id)}">Mağazada bax ${svg("up-right")}</a>`}</details>`).join("");
  } else if (tab==="sales") {
    content.innerHTML=model.sales.map(s=>`<article class="entry"><div><strong>${safe(s.title)} × ${s.qty}</strong><p>${money(s.price*s.qty)} · ${date(s.createdAt)}</p></div>${tag(statuses[s.status]||s.status)}</article>`).join("")||empty("Satışların burada görünəcək.");
  } else {
    content.innerHTML=model.messages.map(m=>`<article class="notice"><strong>${safe(m.name)} · ${safe(m.email)}</strong><p>${safe(m.message)}</p><small class="muted">${date(m.createdAt)}</small></article>`).join("")||empty("Mesaj yoxdur.");
  }
}
function menu(open=false) {
  document.querySelector(".top-nav").classList.toggle("open",open);
  document.querySelector(".mobile-menu").setAttribute("aria-expanded",open?"true":"false");
}
async function route(stay=false) {
  const full=current(),[part,query]=full.split("?"),[base,id]=part.split("/");
  const section=["categories","contact","popular"].includes(base);
  const page=["catalog","product","account"].includes(base)?base:"home";
  const routeId=++data.routeId;
  if (data.searchTimer && page!=="catalog") clearTimeout(data.searchTimer);
  data.product=null;
  for (const item of ["home","catalog","product","account"]) $(item+"-page").hidden=item!==page;
  for (const link of document.querySelectorAll("[data-nav]")) {
    const active=link.dataset.nav===page;
    link.classList.toggle("active",active);if (active) link.setAttribute("aria-current","page"); else link.removeAttribute("aria-current");
  }
  menu(false);
  if (!stay) {
    if (section) requestAnimationFrame(()=>$(base).scrollIntoView({block:"start"}));
    else window.scrollTo({top:0,behavior:"instant"});
  }
  await ready;
  if (!data.api||routeId!==data.routeId) return;
  try {
    if (page==="catalog") await loadCatalog(filterValues(full),routeId);
    if (page==="product") await productPage(decodeURIComponent(id||""),routeId);
    if (page==="account") await accountPage(id||"orders",new URLSearchParams(query),routeId);
  } catch (error) { if (routeId===data.routeId) $(page+"-page").innerHTML=empty(errorText(error)); }
}
$("panel").addEventListener("close",()=>{data.panel=null;});
$("panel").addEventListener("click",event=>{if (event.target===$("panel")) {const rect=$("panel").getBoundingClientRect();if (event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom) closePanel();}});
window.addEventListener("hashchange",()=>{if (data.panel!=="checkout") closePanel();route();});
document.addEventListener("click",async event=>{
  const trigger=event.target.closest("[data-action]");
  if (!trigger) return;
  const {action,id,status,next}=trigger.dataset;
  if (action==="close") {closePanel();return;}
  if (action==="menu") {menu(trigger.getAttribute("aria-expanded")!=="true");return;}
  if (action==="search") {closePanel();to("#catalog");setTimeout(()=>$("catalog-search").focus({preventScroll:true}),40);return;}
  if (action==="account") {closePanel();to("#account");return;}
  if (!data.api) return;
  try {
    switch (action) {
      case "cart":showCart();break;
      case "cart-minus":cartChange(id,-1);break;
      case "cart-plus":cartChange(id,1);break;
      case "add-cart":cartChange(data.product.id,1);showCart();break;
      case "checkout":showCheckout();break;
      case "category":setFilters({category:id});break;
      case "category-prev":selectCategory(categoryIndex-1);break;
      case "category-next":selectCategory(categoryIndex+1);break;
      case "gallery-prev":popularGallery?.scrollPrev(reducedMotion.matches);break;
      case "gallery-next":popularGallery?.scrollNext(reducedMotion.matches);break;
      case "surprise":surpriseWork();break;
      case "art-preview":
        if (data.product) panel("art",data.product.title,`<div class="art-full">${img(data.product.image,data.product.title)}</div>`);
        break;
      case "catalog-more":await loadCatalog(data.catalog.filters,data.routeId,true);break;
      case "demo-role":
        data.api.setDemoRole(id);
        if (next==="checkout") {to("#account/orders");showCheckout();}
        else to(id==="admin"||id==="student"?"#account/works":"#account/orders");
        break;
      case "logout":await data.api.logout();to("#account/signin");break;
      case "notifications":showNotices();await refreshNotices();if (data.panel==="notifications") showNotices();break;
      case "mark-read":
        if (data.user) {await data.api.preferences({seen:true});await refreshNotices();if (data.panel==="notifications") showNotices();else route(true);}
        break;
      case "advance-order":
        trigger.disabled=true;
        try {await data.api.advanceOrder(id,status);toast("Sifariş yeniləndi.");route(true);} finally {trigger.disabled=false;}
        break;
      case "resume-pay": {
        trigger.disabled=true;
        try {
          const result=await data.api.resolvePayment(id);
          if (result.url&&!trigger.dataset.admin) location.assign(result.url);
          else {toast("Ödəniş statusu yoxlanıldı.");route(true);}
        } finally {trigger.disabled=false;}
        break;
      }
      case "refresh-account":route(true);break;
    }
  } catch(error){toast(errorText(error));}
});
$("catalog-search").addEventListener("input",event=>{
  clearTimeout(data.searchTimer);
  const q=event.target.value.trim();
  data.searchTimer=setTimeout(()=>setFilters({q},true),250);
});
$("catalog-form").addEventListener("submit",event=>{event.preventDefault();clearTimeout(data.searchTimer);setFilters({q:$("catalog-search").value.trim()},true);});
document.addEventListener("change",async event=>{
  const {id,value,checked}=event.target;
  if (id==="section-filter") setFilters({section:value});
  if (id==="catalog-sort") setFilters({sort:value});
  if (id==="arrival-pref") {
    try {await data.api.preferences({arrivals:checked});route(true);}
    catch(error){event.target.checked=!checked;toast(errorText(error));}
  }
});
document.addEventListener("submit",async event=>{
  const form=event.target;
  if (form.id==="catalog-form") return;
  if (!["contact-form","checkout-form","auth-form","review-form"].includes(form.id) && !form.dataset.form) return;
  event.preventDefault();
  if (!data.api||form.getAttribute("aria-busy")==="true") return;
  const values=Object.fromEntries(new FormData(form));
  formBusy(form,true);formStatus(form,"");
  try {
    if (form.id==="contact-form") {
      await data.api.contact(values);form.reset();
      formStatus(form,data.api.demo?"Mesaj bu brauzerdə demo üçün saxlanıldı.":"Mesaj göndərildi. Təşəkkür edirik!");
    }
    if (form.id==="auth-form") {
      if (form.dataset.type==="reset") {await data.api.reset(values.email);formStatus(form,"Bərpa linki üçün e-poçtunu yoxla.");}
      else {
        if (form.dataset.type==="signup") await data.api.signup(values.name,values.email,values.password);
        else await data.api.signin(values.email,values.password);
        to("#account/orders"+(form.dataset.next==="checkout"?"?next=checkout":""));
      }
    }
    if (form.id==="checkout-form") {
      if (!data.checkoutId) data.checkoutId=crypto.randomUUID();
      const result=await data.api.checkout({items:data.cart.map(({productId,qty})=>({productId,qty})),name:values.name,phone:values.phone,requestId:data.checkoutId});
      if (result.status==="payment_failed") {data.checkoutId=null;throw Error("Ödəniş səhifəsi açıla bilmədi. Yenidən cəhd et.");}
      data.cart=[];saveCart();closePanel();
      if (result.url) location.assign(result.url);
      else {to("#account/orders");toast(data.api.demo?"Sınaq sifarişi yaradıldı.":"Sifariş kabinetdə saxlanıldı.");refreshNotices().catch(()=>{});}
    }
    if (form.id==="review-form") {
      const productId=data.product.id;
      await data.api.review({productId,text:values.text,rating:Number(values.rating)});
      form.reset();formStatus(form,"Rəy yadda saxlanıldı.");
      const reviews=await data.api.reviews(productId);
      if(data.product?.id===productId) $("product-reviews").innerHTML=reviewList(reviews);
    }
    if (form.dataset.form==="work") {
      const {image,...record}=values;
      await data.api.saveWork({...record,id:form.dataset.id||crypto.randomUUID(),price:Math.round(Number(values.price)*100),stock:Number(values.stock),stockBefore:Number(form.dataset.stock)},image);
      toast("İş yadda saxlanıldı.");await refreshHome();route(true);
    }
    if (form.dataset.form==="taxonomy") {
      await data.api.saveTaxonomy({...values,id:form.dataset.id||crypto.randomUUID(),position:Number(values.position)});
      toast("Dəyişiklik yadda saxlanıldı.");await refreshHome();route(true);
    }
  } catch (error) {formStatus(form,errorText(error),true);}
  finally {formBusy(form,false);}
});
async function initialize() {
  paintCartCount();
  try {
    data.api=config.mode==="firebase"?await (await import("./firebase-client.js")).makeFirebase(config):makeDemo();
    if (data.api.demo) modeLabel.textContent="DEMO VİTRİNİ · NÜMUNƏ İŞLƏR";
    data.api.watchArrivals?.(items=>{data.arrivals=items;updateNoticeDot();if(data.panel==="notifications") showNotices();});
    data.api.watchAuth(user=>{
      data.user=user;data.authReady=true;data.notices=[];data.prefs={};
      data.unsubscribeNotices?.();
      data.unsubscribeNotices=user?data.api.watchNotices?.(user,items=>{data.notices=items;updateNoticeDot();if(data.panel==="notifications") showNotices();}):null;
      refreshNotices().catch(()=>{});
      if (current().startsWith("account")) route(true);
      if ($("review-form-slot")) $("review-form-slot").innerHTML=reviewForm();
    });
    await refreshHome();
  } catch (error) {
    $("home-categories").innerHTML=empty("Mağaza bağlantısı hazır deyil.");
    $("home-products").innerHTML=empty(errorText(error));
    $("account-page").innerHTML=empty("Kabinet bağlantısı hazır deyil.");
  } finally {resolveReady();route();}
}
initialize();
