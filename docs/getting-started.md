# Getting started

```
npm i rawstate
```

## The idea

Three pieces, each one is small:

- A **slice** keeps a few states and the actions that change them.
- A **collection** is a table of rows with an id.
- A **store** puts them together, so changes of several of them can be one transaction and can be linked by relations and rules.

Everything that changes data is an **action** (or a transaction that calls actions). You read with `get()` and watch with `subscribe()`.

## A slice

```ts
import { createSlice } from "rawstate";

const cart = createSlice({
  state: { price: 10, count: 1 },
  actions: {
    setCount: (state, count: number) => ({ count }),
    add: (state, n: number) => ({ count: state.count + n }),
  },
});

cart.actions.add(2);
cart.getState("count").get();                     // 3
const off = cart.getState("count").subscribe((n) => console.log(n));
off();
```

- The first argument of an action is the current state, read-only. The rest are yours, they become the arguments of `cart.actions.add(2)`.
- An action returns **an object with the states to change**. Other states stay as they are and their subscribers are not called.
- Types are checked: a wrong key, a wrong type of value or wrong arguments do not compile.

## A value calculated from states

```ts
import { view } from "rawstate";

const total = view(
  [cart.getState("price"), cart.getState("count")],
  (price, count) => price * count
);

total.get();                  // 30
total.subscribe((value) => console.log(value));   // tells only when the result is different
```

A view is calculated only when a source changes. Views can be made of other views.

## A store and a transaction

```ts
import { createStore } from "rawstate";

const store = createStore({ cart });

store.transaction(() => {
  cart.actions.setCount(5);
  cart.actions.add(1);
  // throw here and both changes are cancelled; subscribers are told once, at the end
});
```

## Describing the state with an interface

The type of the state is taken from the value, which is narrow (`{ user: null }` is `null`). To describe the contract yourself:

```ts
interface Auth { user: { name: string } | null }

const auth = createSlice<Auth>()({
  state: { user: null },
  actions: { login: (_s, name: string) => ({ user: { name } }) },
});
```

## With React

```
npm i rawstate-react
```

```tsx
import { useObserver, useAction, useReadable } from "rawstate-react";

function Cart() {
  const count = useObserver(cart, "count");
  const add = useAction(cart, "add");
  const sum = useReadable(total);                     // any value with get/subscribe, for example a view
  return <button onClick={() => add(1)}>{count} / {sum}</button>;
}
```

Read more in the [rawstate-react](https://www.npmjs.com/package/rawstate-react) package.

## What next

- Async actions, immutability, the rules of actions: [Slices](slices.md).
- Tables of rows: [Collections](collections.md).
- Data with links: [Relations and rules](relations-and-rules.md).
