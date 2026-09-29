import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applicationActionFormIds,
  buildApplicationActionInput,
  getApplicationActionForm,
  getApplicationActionInitialValues
} from '../../src/renderer/domain/application-action-forms';

const record = (id = 17, version = 4, values: Record<string, unknown> = {}) => ({ id, version, values } as any);

test('declares only supported mutating application forms with correct scope', () => {
  assert.deepEqual(applicationActionFormIds, [
    'application.create','application.certificate.create','application.update','application.submit',
    'application.approve','application.reject','application.withdraw','application.revise',
    'application.archive','application.certificate.renew',
    'application.certificate.refresh_reminders','application.reminder.acknowledge'
  ]);
  assert.equal(getApplicationActionForm('application.create')?.scope, 'module');
  assert.equal(getApplicationActionForm('application.certificate.create')?.scope, 'module');
  assert.equal(getApplicationActionForm('application.certificate.refresh_reminders')?.scope, 'module');
  assert.equal(getApplicationActionForm('application.summary'), undefined);
  assert.equal(getApplicationActionForm('application.file.recover'), undefined);
});

test('builds create, versioned application, approval, and certificate requests', () => {
  assert.deepEqual(buildApplicationActionInput(getApplicationActionForm('application.create')!, {
    applicationType:'distribution', title:'Edge package approval', content:'Approve distribution package'
  }), {applicationType:'distribution', title:'Edge package approval', content:'Approve distribution package'});
  assert.deepEqual(buildApplicationActionInput(getApplicationActionForm('application.update')!, {
    applicationType:'distribution', title:'Revised title', content:'Revised content'
  }, record(7,3)), {applicationId:7,expectedVersion:3,applicationType:'distribution',title:'Revised title',content:'Revised content'});
  assert.deepEqual(buildApplicationActionInput(getApplicationActionForm('application.approve')!, {
    nodeId:'31', expectedNodeVersion:'2', comment:'Approved'
  }, record(7,3)), {applicationId:7,expectedApplicationVersion:3,nodeId:31,expectedNodeVersion:2,comment:'Approved'});
  assert.deepEqual(buildApplicationActionInput(getApplicationActionForm('application.certificate.renew')!, {
    businessVersion:'2.0',name:'License',certificateNo:'CERT-2',issuedAt:'2026-09-29',expiresAt:'',fileVersionCode:''
  }, record(9,5)), {
    previousCertificateId:9,expectedPreviousVersion:5,businessVersion:'2.0',name:'License',certificateNo:'CERT-2',
    issuedAt:'2026-09-29',expiresAt:null,fileVersionCode:null
  });
});

test('injects record identity and prefills editable values', () => {
  assert.deepEqual(buildApplicationActionInput(getApplicationActionForm('application.submit')!, {comment:'Submit'}, record(4,2)), {
    applicationId:4,expectedVersion:2,comment:'Submit'
  });
  assert.deepEqual(buildApplicationActionInput(getApplicationActionForm('application.reminder.acknowledge')!, {}, record(8,6)), {
    reminderId:8,expectedVersion:6
  });
  assert.deepEqual(getApplicationActionInitialValues(getApplicationActionForm('application.update')!, record(4,2, {
    application_type:'distribution',title:'Existing',content:'Existing content'
  })), {applicationType:'distribution',title:'Existing',content:'Existing content'});
});

test('rejects malformed, unexpected, and recordless application values without echoing them', () => {
  assert.throws(() => buildApplicationActionInput(getApplicationActionForm('application.create')!, {
    applicationType:'distribution',title:'Title',content:'Body',secret:'do-not-echo'
  } as any), (error:Error) => !error.message.includes('do-not-echo'));
  assert.throws(() => buildApplicationActionInput(getApplicationActionForm('application.certificate.create')!, {
    certificateKey:'license',businessVersion:'1.0',name:'License',certificateNo:'C-1',issuedAt:'2026-02-30',expiresAt:'',fileVersionCode:''
  }), /form input/i);
  assert.throws(() => buildApplicationActionInput(getApplicationActionForm('application.submit')!, {comment:'Submit'}), /record/i);
});
