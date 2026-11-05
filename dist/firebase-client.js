const version = "12.12.0";
const sdk = module => import("https://www.gstatic.com/firebasejs/" + version + "/firebase-" + module + ".js");
const timestamp = value => typeof value?.toMillis === "function" ? value.toMillis() : value;
const row = snap => {
  const data=snap.data();
  return {...data,id:snap.id,createdAt:timestamp(data.createdAt),publishedAt:timestamp(data.publishedAt)};
};

export async function makeFirebase(config) {
  const [appApi,authApi,dbApi,fnApi,storageApi]=await Promise.all(["app","auth","firestore","functions","storage"].map(sdk));
  const app=appApi.initializeApp(config.firebase);
  const auth=authApi.getAuth(app), db=dbApi.getFirestore(app);
  const functions=fnApi.getFunctions(app,config.region), storage=storageApi.getStorage(app);
  const emulator=config.emulators;
  if (emulator) {
    authApi.connectAuthEmulator(auth,"http://127.0.0.1:9099",{disableWarnings:true});
    dbApi.connectFirestoreEmulator(db,"127.0.0.1",8080);
    fnApi.connectFunctionsEmulator(functions,"127.0.0.1",5001);
    storageApi.connectStorageEmulator(storage,"127.0.0.1",9199);
  }
  const {collection,doc,getDoc,getDocs,query,where,limit,orderBy,startAfter,onSnapshot}=dbApi;
  const call=async (name,data) => (await fnApi.httpsCallable(functions,name)(data)).data;
  const rows=async (source,...clauses) => (await getDocs(query(source,...clauses))).docs.map(row);
  const userPath=(...tail)=>["users",auth.currentUser.uid,...tail];
  const prefs=async ()=>(await getDoc(doc(db,...userPath()))).data() || {};
  const documents=(name,...rest)=>collection(db,name,...rest);
  const viewSession=()=> {
    try {
      let id=localStorage.getItem("unec-shop-visitor");
      if (!id) {id=crypto.randomUUID();localStorage.setItem("unec-shop-visitor",id);}
      return id;
    } catch { return ""; }
  };
  return {
    demo:false,
    watchAuth(callback) {
      return authApi.onIdTokenChanged(auth,async user=>{
        if (!user) return callback(null);
        const token=await user.getIdTokenResult();
        if (auth.currentUser?.uid!==user.uid) return;
        callback({uid:user.uid,role:token.claims.role || "buyer",name:user.displayName || user.email,email:user.email});
      });
    },
    async signin(email,password) { await authApi.signInWithEmailAndPassword(auth,email,password); },
    async signup(name,email,password) {
      const result=await authApi.createUserWithEmailAndPassword(auth,email,password);
      await authApi.updateProfile(result.user,{displayName:name});
      await result.user.getIdToken(true);
    },
    async reset(email) { await authApi.sendPasswordResetEmail(auth,email); },
    async logout() { await authApi.signOut(auth); },
    taxonomy:()=>rows(documents("taxonomy"),orderBy("position"),limit(120)),
    watchArrivals:callback=>onSnapshot(query(documents("arrivals"),orderBy("publishedAt","desc"),limit(5)),snap=>callback(snap.docs.map(row)),()=>{}),
    watchNotices:(user,callback)=>onSnapshot(query(documents("users",user.uid,"notifications"),orderBy("createdAt","desc"),limit(50)),snap=>callback(snap.docs.map(row)),()=>{}),
    async list(filters={},cursor,size=16) {
      const field=filters.sort==="popular"?"views":["price-low","price-high"].includes(filters.sort)?"price":"publishedAt";
      const dir=filters.sort==="price-low"?"asc":"desc";
      const constraints=[where("status","==","published")];
      if (filters.category) constraints.push(where("category","==",filters.category));
      if (filters.section) constraints.push(where("section","==",filters.section));
      constraints.push(orderBy(field,dir));
      if (cursor) constraints.push(startAfter(cursor));
      const page=(await getDocs(query(documents("products"),...constraints,limit(size)))).docs;
      const items=page.map(row);
      const q=filters.q?.toLocaleLowerCase("az");
      return {items:q ? items.filter(p=>[p.title,p.author,p.description].some(v=>v.toLocaleLowerCase("az").includes(q))) : items,cursor:page.at(-1),more:page.length===size};
    },
    async product(id) {
      try { const snap=await getDoc(doc(db,"products",id)); return snap.exists() && snap.data().status==="published" ? row(snap) : null; }
      catch (error) { if (error.code==="permission-denied") return null; throw error; }
    },
    reviews:id=>rows(documents("products",id,"reviews"),orderBy("createdAt","desc"),limit(30)),
    view:id=>call("recordView",{id,visitor:viewSession()}),
    contact:data=>call("sendQuestion",data),
    async account(user) {
      const orders=rows(documents("orders"),where("buyerUid","==",user.uid),orderBy("createdAt","desc"),limit(50));
      const works=user.role==="admin" ? rows(documents("products"),orderBy("createdAt","desc"),limit(100)) : user.role==="student" ? rows(documents("products"),where("sellerUid","==",user.uid),orderBy("createdAt","desc"),limit(50)) : [];
      const sales=user.role==="student" ? rows(documents(...userPath("sales")),orderBy("createdAt","desc"),limit(50)) : [];
      const adminOrders=user.role==="admin" ? rows(documents("orders"),orderBy("createdAt","desc"),limit(100)) : [];
      const messages=user.role==="admin" ? rows(documents("questions"),orderBy("createdAt","desc"),limit(50)) : [];
      const [o,w,s,a,m]=await Promise.all([orders,works,sales,adminOrders,messages]);
      return {orders:o,works:w,sales:s,adminOrders:a,messages:m};
    },
    async notices(user) {
      if (!user) return {items:[],prefs:{}};
      const [items,profile]=await Promise.all([rows(documents(...userPath("notifications")),orderBy("createdAt","desc"),limit(50)),prefs()]);
      return {items,prefs:profile};
    },
    async preferences(patch) { await call("savePreferences",patch); },
    checkout:data=>call("startCheckout",data),
    review:data=>call("writeReview",data),
    async saveWork(data,file) {
      if (file?.size) {
        if (file.size>5*1024*1024 || !["image/jpeg","image/png","image/webp","image/avif"].includes(file.type)) throw Error("JPEG, PNG, WebP və ya AVIF faylı (5 MB-a qədər) seç.");
        data.imagePath="work-images/"+auth.currentUser.uid+"/"+data.id+"/"+crypto.randomUUID();
        await storageApi.uploadBytes(storageApi.ref(storage,data.imagePath),file,{contentType:file.type});
      }
      await call("saveWork",data);
    },
    saveTaxonomy:data=>call("saveTaxonomy",data),
    advanceOrder:(id,status)=>call("advanceOrder",{id,status}),
    resolvePayment:id=>call("resolvePayment",{id}),
  };
}
