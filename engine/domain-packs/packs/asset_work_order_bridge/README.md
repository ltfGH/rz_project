# Asset Work Order Bridge

`asset_work_order_bridge@1.0.0` links work orders to assets through public blueprint extension points.

- `asset.work_order.create` validates the asset, creates the work order, and stores the relation in the caller transaction.
- `asset.deactivation.work_order` blocks asset deactivation while a related work order is not closed.
- Asset and work-order detail views expose the relation without changing either core lifecycle.
