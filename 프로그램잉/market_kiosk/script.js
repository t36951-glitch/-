const items = [
  {cat:'과일', emoji:'🍎', name:'사과', price:1000},
  {cat:'과일', emoji:'🍌', name:'바나나', price:1000},
  {cat:'채소', emoji:'🥕', name:'당근', price:800},
  {cat:'채소', emoji:'🥬', name:'상추', price:900},
  {cat:'간식', emoji:'🍞', name:'빵', price:2000},
  {cat:'간식', emoji:'🍪', name:'쿠키', price:1500},
  {cat:'음료', emoji:'🥛', name:'우유', price:1500},
  {cat:'음료', emoji:'🧃', name:'주스', price:1200},
  {cat:'장난감', emoji:'🧸', name:'곰인형', price:5000},
  {cat:'장난감', emoji:'🚗', name:'자동차', price:4500},
];
const places = ['우리 반','옆 반','교무실','놀이터 앞'];
const memos = ['문 앞에 놓아주세요','친구에게 전해주세요'];
const state = {screen:'start', cart:{}, method:'', place:'', memo:'', pay:''};
const categories = [...new Set(items.map(i=>i.cat))];
let currentCat = categories[0];

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const money = n => `${n.toLocaleString('ko-KR')}원`;

function show(screen){ state.screen = screen; $$('.screen').forEach(v=>v.classList.remove('active')); $(`#screen-${screen}`).classList.add('active'); }
function total(){ return Object.entries(state.cart).reduce((sum,[idx,qty])=>sum + items[idx].price*qty,0); }
function cartCount(){ return Object.values(state.cart).reduce((a,b)=>a+b,0); }

function renderCategories(){
  const tabs = $('#categoryTabs');
  tabs.innerHTML = categories.map(cat=>`<button class="cat-btn ${cat===currentCat?'active':''}" data-cat="${cat}">${cat}</button>`).join('');
  $$('.cat-btn').forEach(b=>b.onclick = ()=>{ currentCat=b.dataset.cat; renderCategories(); renderItems(); });
}

function renderItems(){
  const grid = $('#itemGrid');
  const list = items.filter(i=>i.cat===currentCat);
  grid.innerHTML = list.map(it=>{
    const idx = items.indexOf(it);
    return `<article class="item-card" data-idx="${idx}">
      <div class="emoji">${it.emoji}</div>
      <div class="item-name">${it.name}</div>
      <div class="price">${money(it.price)}</div>
      <div class="qty-row">
        <button class="qty-btn" data-action="minus">-</button>
        <span class="qty-num" data-qty>1</span>
        <button class="qty-btn" data-action="plus">+</button>
      </div>
      <button class="add-btn">장바구니 담기</button>
    </article>`;
  }).join('');

  $$('.item-card').forEach(card=>{
    let qty=1;
    const q = card.querySelector('[data-qty]');
    card.querySelector('[data-action="minus"]').onclick = ()=>{ qty=Math.max(1,qty-1); q.textContent=qty; };
    card.querySelector('[data-action="plus"]').onclick = ()=>{ qty=Math.min(9,qty+1); q.textContent=qty; };
    card.querySelector('.add-btn').onclick = ()=>{
      const idx = Number(card.dataset.idx);
      state.cart[idx] = (state.cart[idx]||0) + qty;
      updateCartBadge();
      alert(`${items[idx].name} ${qty}개 담았어요!`);
    };
  });
}

function renderCart(){
  const list = $('#cartList');
  const rows = Object.entries(state.cart);
  if (!rows.length){ list.innerHTML = '<p>장바구니가 비었어요.</p>'; $('#totalPrice').textContent='0원'; return; }
  list.innerHTML = rows.map(([idx,qty])=>{
    const it = items[idx];
    return `<div class="cart-item">
      <div>${it.emoji} ${it.name}</div><div>${qty}개</div><div>${money(it.price*qty)}</div>
      <button class="btn btn-soft" data-del="${idx}">삭제</button>
    </div>`;
  }).join('');
  $('#totalPrice').textContent = money(total());
  $$('[data-del]').forEach(b=>b.onclick = ()=>{ delete state.cart[b.dataset.del]; renderCart(); updateCartBadge(); });
}

function updateCartBadge(){ $('#cartCount').textContent = `장바구니 ${cartCount()}개`; }

function renderDeliveryChoices(){
  $('#deliveryPlace').innerHTML = places.map(p=>`<button class="choice ${state.place===p?'selected':''}" data-place="${p}">${p}</button>`).join('');
  $('#deliveryMemo').innerHTML = memos.map(m=>`<button class="choice ${state.memo===m?'selected':''}" data-memo="${m}">${m}</button>`).join('');
  $$('[data-place]').forEach(b=>b.onclick=()=>{ state.place=b.dataset.place; renderDeliveryChoices(); });
  $$('[data-memo]').forEach(b=>b.onclick=()=>{ state.memo=b.dataset.memo; renderDeliveryChoices(); });
}

function renderReceipt(){
  const rows = Object.entries(state.cart).map(([idx,qty])=>`${items[idx].name} ${qty}개 - ${money(items[idx].price*qty)}`).join('<br>');
  $('#orderNo').textContent = `주문번호: #${Math.floor(Math.random()*900+100)}`;
  $('#receipt').innerHTML = `
    <strong>주문 물건</strong><br>${rows}<hr>
    총액: <b>${money(total())}</b><br>
    방법: <b>${state.method}</b><br>
    ${state.method==='배달 주문하기' ? `장소: <b>${state.place}</b><br>메모: <b>${state.memo}</b><br>` : ''}
    결제: <b>${state.pay}</b>
  `;
}

$$('[data-go]').forEach(b=>b.onclick = ()=> show(b.dataset.go));
$$('[data-back]').forEach(b=>b.onclick = ()=> show(b.dataset.back));
$('#toCart').onclick = ()=>{ renderCart(); show('cart'); };
$('#toMethod').onclick = ()=>{
  if (!cartCount()) return alert('물건을 먼저 담아주세요!');
  show('method');
};

$$('[data-method]').forEach(b=>b.onclick = ()=>{
  state.method = b.dataset.method;
  if (state.method === '배달 주문하기') { renderDeliveryChoices(); show('delivery'); }
  else { show('pay'); }
});

$('#toPayFromDelivery').onclick = ()=>{
  if (!state.place || !state.memo) return alert('장소와 메모를 골라주세요!');
  show('pay');
};

$$('[data-pay]').forEach(b=>b.onclick = ()=>{
  state.pay = b.dataset.pay;
  renderReceipt();
  show('done');
});

$('#showReceipt').onclick = ()=> alert('아래 영수증을 함께 읽어보세요!');
$('#goStart').onclick = ()=>{
  state.cart={}; state.method=''; state.place=''; state.memo=''; state.pay='';
  updateCartBadge(); renderCart(); show('start');
};

renderCategories(); renderItems(); updateCartBadge();
