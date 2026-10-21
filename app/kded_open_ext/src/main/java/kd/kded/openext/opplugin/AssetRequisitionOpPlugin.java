package kd.kded.openext.opplugin;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import kd.bos.dataentity.entity.DynamicObject;
import kd.bos.dataentity.entity.DynamicObjectCollection;
import kd.bos.dataentity.resource.ResManager;
import kd.bos.entity.plugin.AbstractOperationServicePlugIn;
import kd.bos.entity.plugin.PreparePropertysEventArgs;
import kd.bos.entity.plugin.args.EndOperationTransactionArgs;
import kd.bos.logging.Log;
import kd.bos.logging.LogFactory;
import kd.bos.servicehelper.BusinessDataServiceHelper;
import kd.bos.servicehelper.operation.SaveServiceHelper;

/**
 * 资产申领单审核操作插件
 * 审核通过后自动扣减固定资产台账可用库存并更新已分配数量
 */
public class AssetRequisitionOpPlugin extends AbstractOperationServicePlugIn {
    private static final Log logger = LogFactory.getLog(AssetRequisitionOpPlugin.class);

    private static final String ENTRY_ENTITY = "kded_asset_requisitio2";
    private static final String FIELD_LEDGER_REF = "kded_asset_ledger_ref";
    private static final String FIELD_REQUISITION_QTY = "kded_requisition_qty";
    private static final String FIELD_AVAILABLE_QTY = "kded_available_qty";
    private static final String FIELD_ALLOCATED_QTY = "kded_allocated_qty";
    private static final String LEDGER_FORM_NUMBER = "kded_asset_ledger";

    @Override
    public void onPreparePropertys(PreparePropertysEventArgs e) {
        super.onPreparePropertys(e);
        List<String> fieldKeys = e.getFieldKeys();
        fieldKeys.add(ENTRY_ENTITY);
        fieldKeys.add(FIELD_LEDGER_REF);
        fieldKeys.add(FIELD_REQUISITION_QTY);
    }

    @Override
    public void endOperationTransaction(EndOperationTransactionArgs e) {
        super.endOperationTransaction(e);
        DynamicObject[] dataEntities = e.getDataEntities();
        if (dataEntities == null || dataEntities.length == 0) {
            return;
        }

        // Step 1: 收集并汇总所有申领单分录中各台账的扣减数量
        Map<Long, BigDecimal> ledgerDeductions = new HashMap<>();
        for (DynamicObject requisition : dataEntities) {
            DynamicObjectCollection entries = requisition.getDynamicObjectCollection(ENTRY_ENTITY);
            if (entries == null) {
                continue;
            }
            for (DynamicObject entry : entries) {
                DynamicObject ledgerRef = entry.getDynamicObject(FIELD_LEDGER_REF);
                if (ledgerRef == null) {
                    continue;
                }
                Object pkValue = ledgerRef.getPkValue();
                if (pkValue == null) {
                    continue;
                }
                long ledgerId = ((Number) pkValue).longValue();
                BigDecimal qty = entry.getBigDecimal(FIELD_REQUISITION_QTY);
                if (qty == null || qty.compareTo(BigDecimal.ZERO) <= 0) {
                    continue;
                }
                ledgerDeductions.merge(ledgerId, qty, BigDecimal::add);
            }
        }

        if (ledgerDeductions.isEmpty()) {
            return;
        }

        // Step 2: 批量加载所有受影响的固定资产台账记录（避免循环内查库）
        Object[] ledgerIds = ledgerDeductions.keySet().toArray();
        DynamicObject[] ledgerRecords = BusinessDataServiceHelper.load(ledgerIds, LEDGER_FORM_NUMBER);
        if (ledgerRecords == null || ledgerRecords.length == 0) {
            logger.error(ResManager.loadKDString(
                "固定资产台账记录不存在，无法扣减库存",
                "AssetRequisitionOpPlugin_0", "opplugin"));
            return;
        }

        // Step 3: 更新每条台账记录的可用库存和已分配数量
        List<DynamicObject> toSave = new ArrayList<>();
        for (DynamicObject ledger : ledgerRecords) {
            Object pkValue = ledger.getPkValue();
            if (pkValue == null) {
                continue;
            }
            long ledgerId = ((Number) pkValue).longValue();
            BigDecimal deduction = ledgerDeductions.get(ledgerId);
            if (deduction == null) {
                continue;
            }

            BigDecimal available = ledger.getBigDecimal(FIELD_AVAILABLE_QTY);
            BigDecimal allocated = ledger.getBigDecimal(FIELD_ALLOCATED_QTY);
            if (available == null) {
                available = BigDecimal.ZERO;
            }
            if (allocated == null) {
                allocated = BigDecimal.ZERO;
            }

            BigDecimal newAvailable = available.subtract(deduction);
            BigDecimal newAllocated = allocated.add(deduction);

            ledger.set(FIELD_AVAILABLE_QTY, newAvailable);
            ledger.set(FIELD_ALLOCATED_QTY, newAllocated);
            toSave.add(ledger);

            logger.info(ResManager.loadKDString(
                "固定资产台账库存更新",
                "AssetRequisitionOpPlugin_2", "opplugin")
                + ": ledgerId=" + ledgerId
                + ", deduction=" + deduction
                + ", newAvailable=" + newAvailable
                + ", newAllocated=" + newAllocated);
        }

        // Step 4: 批量保存所有更新后的台账记录
        if (!toSave.isEmpty()) {
            SaveServiceHelper.save(toSave.toArray(new DynamicObject[0]));
        }
    }
}
