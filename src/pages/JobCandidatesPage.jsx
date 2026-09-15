import { useState, useEffect } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import Navbar from "../components/Navbar";
import { notifyStatusChange } from '../services/notificationService';
import { supabase } from "../lib/supabase";
import "../styles/JobCandidatesPage.css";
import { DocumentCheckIcon, CircularCheckSuccessIcon, CheckInterviewIconDashboard, CheckMarkSquareInterviewIcon,  PdfIcon, CheckboxMassIcon, ReverseTabArrowIcon, JusticePlumpIcon, CheckSquareIcon, MagnifyingGlassPlumpIcon } from "../components/icons/CustomIcons";
import JobCandidateButton from "../components/JobCandidateButton";
import communityLogo from '../assets/community3-icon.png';
import calendarminimalLogo from '../assets/calendar-minimal-icon.png';
import compareplumpLogo from '../assets/compare-plump-icon.png';
import Loader from '../components/Loader';


export default function JobCandidatesPage() {
// ─── Helper: extract a short label from a factor string ──
const extractFactorLabel = (factor) => {
  const text = factor.replace(/^✓\s*/, '').trim().toLowerCase();
  if (text.includes('master') || text.includes('bachelor') || text.includes('degree')) return 'education';
  if (text.includes('experience')) return 'work experience';
  if (text.includes('eligibility') || text.includes('professional') || text.includes('subprofessional')) return 'eligibility';
  if (text.includes('training')) return 'training';
  return null;
};

// ─── Helper: join with natural "a, b, and c" ─────────
const joinNatural = (items) => {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
};

// ─── Helper: extract the gap value cleanly ───────────
const getGapValue = (factor) => {
  const colonSplit = factor.split(':');
  if (colonSplit.length < 2) return factor;

  const label = colonSplit[0].trim().toLowerCase();
  const rest = colonSplit[1].trim();

  const ratioMatch = rest.match(/(\d+)\s*\/\s*(\d+)/);
  if (ratioMatch) {
    const [, current, required] = ratioMatch;
    return `${current} ${label}, which is below the required ${required}`;
  }

  return rest;
};

// ─── Main function: build the narrative summary ──────
const buildSummary = (applicant) => {
  const exp = applicant.explanation || {};
  const firstName = (applicant.applicant_name || 'The applicant').split(' ')[0];

  const metFactors = exp.contributing_factors || [];
  const reducedFactors = exp.score_reduced || [];
  const requirementsMet = exp.requirements_met || '';

  const [metCount, totalCount] = requirementsMet.split('/').map(Number);

  // ── Meets everything ────────────────────────────────
  if (reducedFactors.length === 0) {
    return `${firstName} meets all ${totalCount} requirements and is highly suitable for this position.`;
  }

  // ── Strong candidate (75%+) ─────────────────────────
  if (metCount >= totalCount * 0.75) {
    const metLabels = metFactors.map(extractFactorLabel).filter(Boolean);
    const metText = joinNatural(metLabels);
    return `${firstName} meets the ${metText} requirements. However, the applicant currently has ${getGapValue(reducedFactors[0])}. This is a minor gap that may be addressed before placement.`;
  }

  // ── Borderline (50–74%) ─────────────────────────────
  if (metCount >= totalCount * 0.5) {
    return `${firstName} meets ${metCount} of ${totalCount} requirements. While the applicant satisfies key criteria, gaps exist that may affect suitability. Review the details above before deciding.`;
  }

  // ── Not suitable (<50%) ─────────────────────────────
  return `${firstName} does not currently meet the position requirements and may not be suitable at this time.`;
};

const [showStatusConfirm, setShowStatusConfirm] = useState(false);
const [pendingStatus, setPendingStatus] = useState(null);
const [statusSuccessMessage, setStatusSuccessMessage] = useState('');


const [showBulkConfirmModal, setShowBulkConfirmModal] = useState(false);
const [pendingBulkStatus, setPendingBulkStatus] = useState(null);
const [bulkUpdateSuccessMessage, setBulkUpdateSuccessMessage] = useState(null);

  const { jobId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const returnPath = location.state?.from || '/hr/jobs';

  const [loading, setLoading] = useState(true);
  const [job, setJob] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("All");
  const [filterDocuments, setFilterDocuments] = useState("All");
  const [sortBy, setSortBy] = useState("rank");
  const [sortOrder, setSortOrder] = useState("asc");
  const [selectedApplication, setSelectedApplication] = useState(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [showExplainModal, setShowExplainModal] = useState(false);
  const [selectedForExplain, setSelectedForExplain] = useState(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [documentUrls, setDocumentUrls] = useState({});

  const [compareMode, setCompareMode] = useState(false);
  const [selectedCompareCandidates, setSelectedCompareCandidates] = useState([]);
  const [showCompareModal, setShowCompareModal] = useState(false);

  // NEW: Mass Select States
  const [massSelectMode, setMassSelectMode] = useState(false);
  const [selectedRows, setSelectedRows] = useState([]);
  const [bulkStatus, setBulkStatus] = useState('SHORTLISTED');
  const [bulkUpdating, setBulkUpdating] = useState(false);

  // Store job requirements for comparison
  const [jobRequirements, setJobRequirements] = useState({
    education: 0,
    eligibility: '',
    training: 0,
    workExperience: 0,
  });

  useEffect(() => {
    loadJobAndCandidates();
  }, [jobId]);

  const getDocumentUrl = async (jobId, applicantId, docType) => {
    try {
      const { data, error } = await supabase.storage
        .from('applicant_docs')
        .list(`${jobId}/${applicantId}`);

      if (error) {
        console.error('Error listing files:', error);
        return null;
      }

      if (!data || data.length === 0) {
        console.log('No files found in folder');
        return null;
      }

      const file = data.find(f => f.name.startsWith(docType));

      if (!file) {
        console.log(`No file found starting with: ${docType}`);
        return null;
      }

      const filePath = `${jobId}/${applicantId}/${file.name}`;
      const { data: urlData } = supabase.storage
        .from('applicant_docs')
        .getPublicUrl(filePath);

      console.log(`Found ${docType} file:`, file.name);
      return urlData.publicUrl;
    } catch (error) {
      console.error('Error getting document URL:', error);
      return null;
    }
  };

  const viewDocument = async (jobId, applicantId, docType, docName) => {
    try {
      const { data, error } = await supabase.storage
        .from('applicant_docs')
        .list(`${jobId}/${applicantId}`);

      if (error || !data) {
        alert('Could not find documents folder.');
        return;
      }

      const matchingFiles = data.filter(f => 
        f.name.toLowerCase().startsWith(docType.toLowerCase())
      );
      
      if (matchingFiles.length === 0) {
        alert(`No ${docName} file found.`);
        console.log('Available files:', data.map(f => f.name));
        return;
      }

      const sortedFiles = matchingFiles.sort((a, b) => {
        return new Date(b.created_at) - new Date(a.created_at);
      });

      const file = sortedFiles[0];
      const filePath = `${jobId}/${applicantId}/${file.name}`;
      const { data: urlData } = supabase.storage
        .from('applicant_docs')
        .getPublicUrl(filePath);

      const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls');
      const isWord = file.name.endsWith('.docx') || file.name.endsWith('.doc');

      if (isExcel || isWord) {
        const link = document.createElement('a');
        link.href = urlData.publicUrl;
        link.download = file.name;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } else {
        window.open(urlData.publicUrl, '_blank');
      }
    } catch (error) {
      console.error('Error viewing document:', error);
      alert('Error viewing document. Please try again.');
    }
  };

  const loadJobAndCandidates = async () => {
    setLoading(true);
    
    try {
      const { data: jobData, error: jobError } = await supabase
        .from('job_postings')
        .select('*')
        .eq('id', jobId)
        .single();
      
      if (jobError) throw jobError;
      setJob(jobData);
      
      setJobRequirements({
        education: parseInt(jobData?.required_education) || 0,
        eligibility: jobData?.required_eligibility || '',
        training: parseInt(jobData?.required_training) || 0,
        workExperience: parseInt(jobData?.required_work_experience) || 0,
      });
      
      const { data: applicationsData, error: appsError } = await supabase
        .from('applications')
        .select('*')
        .eq('job_id', jobId)
        .neq('status', 'WITHDRAWN')
        .order('applied_date', { ascending: false });
      
      if (appsError) throw appsError;
      
      if (!applicationsData || applicationsData.length === 0) {
        setCandidates([]);
        setLoading(false);
        return;
      }
      
      const applicantIds = [...new Set(applicationsData.map(app => app.applicant_id))];
      
      const { data: applicantsData, error: applicantsError } = await supabase
        .from('applicants')
        .select('*')
        .in('id', applicantIds);
      
      if (applicantsError) throw applicantsError;
      
      const applicantsMap = {};
      applicantsData.forEach(applicant => {
        applicantsMap[applicant.id] = applicant;
      });
      
      const docUrls = {};
      for (const app of applicationsData) {
        const appId = app.id;
        docUrls[appId] = {};
        
        const docTypes = ['pds', 'transcript', 'performanceRating'];
        for (const docType of docTypes) {
          if (app.docs_submitted?.[docType]) {
            const url = await getDocumentUrl(app.job_id, app.applicant_id, docType);
            docUrls[appId][docType] = url;
          } else {
            docUrls[appId][docType] = null;
          }
        }
      }
      setDocumentUrls(docUrls);
      
      const candidatesWithoutRank = applicationsData.map((app) => {
        const applicant = applicantsMap[app.applicant_id] || {};
        const aiData = app.ai_explanation || {};
        const breakdown = aiData.breakdown || {};
        
        const contributingFactors = [];
        const scoreReduced = [];
        
        for (const [key, value] of Object.entries(breakdown)) {
          const status = value.status || '';
          const required = value.required || 0;
          const actual = value.actual || 0;
          
          const isExactMet = status === 'MET' || 
                             (status.includes('EXCEEDS')) ||
                             (status.startsWith('MET ') && !status.startsWith('NOT MET'));
          
          const isNotMet = status.includes('NOT MET');
          const requirementMet = isExactMet && !isNotMet;
          
          if (requirementMet) {
            if (key === 'Education') {
              const eduLevels = ['', 'Elementary', 'High School', '2-Year College', "Bachelor's", "Master's", "PhD/Doctorate"];
              const actualLevel = eduLevels[actual] || `Level ${actual}`;
              const reqLevel = eduLevels[required] || `Level ${required}`;
              contributingFactors.push(`Has ${actualLevel} degree (meets ${reqLevel} requirement)`);
            } else if (key === 'Experience') {
              contributingFactors.push(`Has ${actual} years of relevant experience (meets ${required} year requirement)`);
            } else if (key === 'Training Hours') {
              contributingFactors.push(`Completed ${actual} training hours (meets ${required} hour requirement)`);
            } else if (key === 'Eligibility') {
              const eligDisplay = typeof actual === 'string' ? actual : actual;
              contributingFactors.push(`Has Career Service ${eligDisplay} eligibility`);
            } else {
              contributingFactors.push(`${key}: ${status}`);
            }
          } else if (status.includes('%') && !status.includes('NOT REQUIRED')) {
            if (key === 'Experience') {
              scoreReduced.push(`Experience: ${actual} years (needs ${required} years)`);
            } else if (key === 'Training Hours') {
              const gap = required - actual;
              scoreReduced.push(`Training Hours: ${actual}/${required} hours (needs ${gap} more hours)`);
            } else if (key === 'Education') {
              const eduLevels = ['', 'Elementary', 'High School', '2-Year College', "Bachelor's", "Master's", "PhD/Doctorate"];
              const actualLevel = eduLevels[actual] || `Level ${actual}`;
              const reqLevel = eduLevels[required] || `Level ${required}`;
              scoreReduced.push(`Education: ${actualLevel} (needs ${reqLevel})`);
            } else {
              scoreReduced.push(`${key}: ${status}`);
            }
          } else if (isNotMet || (!status.includes('NOT REQUIRED') && !requirementMet)) {
            if (key === 'Eligibility') {
              const eligDisplay = typeof actual === 'string' ? actual : actual;
              const reqDisplay = typeof required === 'string' ? required : required;
              scoreReduced.push(`Eligibility: Has Career Service ${eligDisplay} (needs ${reqDisplay})`);
            } else if (key === 'Experience') {
              scoreReduced.push(`Experience: ${actual} years (needs ${required} years)`);
            } else if (key === 'Training Hours') {
              const gap = required - actual;
              scoreReduced.push(`Training Hours: ${actual}/${required} hours (needs ${gap} more hours)`);
            } else if (key === 'Education') {
              const eduLevels = ['', 'Elementary', 'High School', '2-Year College', "Bachelor's", "Master's", "PhD/Doctorate"];
              const actualLevel = eduLevels[actual] || `Level ${actual}`;
              const reqLevel = eduLevels[required] || `Level ${required}`;
              scoreReduced.push(`Education: ${actualLevel} (needs ${reqLevel})`);
            } else if (!status.includes('NOT REQUIRED')) {
              scoreReduced.push(`${key}: ${status}`);
            }
          }
        }
        
        if (contributingFactors.length === 0) {
          contributingFactors.push('Received partial score based on related qualifications');
        }
        
        return {
          id: app.id,
          applicant_id: app.applicant_id,
          applicant_name: applicant.full_name || 'Unknown',
          applicant_email: applicant.email || 'No email',
          applied_date: app.applied_date,
          status: app.status || 'PENDING',
          docs_submitted: app.docs_submitted || {},
          ai_match_score: app.ai_match_score || 0,
          education: extractEducation(breakdown),
          eligibility: extractEligibility(breakdown),
          training: extractTraining(breakdown),
          experience: extractExperience(breakdown),
          explanation: {
            contributing_factors: contributingFactors,
            score_reduced: scoreReduced,
            recommendation: aiData.recommendation || aiData.summary || 'Review candidate qualifications.',
            summary: aiData.summary || '',
            requirements_met: aiData.requirements_met || '0/0',
            verdict: aiData.verdict || 'NOT FIT'
          },
          job_id: app.job_id,
          applicant_id: app.applicant_id,
        };
      });
      
      candidatesWithoutRank.sort((a, b) => (b.ai_match_score || 0) - (a.ai_match_score || 0));
      
      const candidatesWithRank = candidatesWithoutRank.map((candidate, index) => ({
        ...candidate,
        rank: index + 1
      }));
      
      setCandidates(candidatesWithRank);
      
    } catch (error) {
      console.error('Error loading job candidates:', error);
      alert('Error loading candidates: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const cleanEducationText = (edu) => {
    if (!edu || edu === 'N/A') return 'N/A';
    const cleaned = edu.replace(/\s*\([^)]*\)/g, '').trim();
    return cleaned || edu;
  };

  const extractEducation = (breakdown) => {
    if (breakdown.Education) {
      const edu = breakdown.Education;
      const eduLevels = ['', 'Elementary', 'High School', '2-Year College', "Bachelor's", "Master's", "PhD/Doctorate"];
      const actualLevel = eduLevels[edu.actual] || `Level ${edu.actual}`;
      const reqLevel = eduLevels[edu.required] || `Level ${edu.required}`;
      return `${actualLevel} `;
    }
    return 'N/A';
  };

  const extractEligibility = (breakdown) => {
    if (breakdown.Eligibility) {
      const elig = breakdown.Eligibility;
      return elig.actual || 'None';
    }
    return 'N/A';
  };

  const extractTraining = (breakdown) => {
    if (breakdown['Training Hours']) {
      const train = breakdown['Training Hours'];
      return `${train.actual || 0}/${train.required || 0} hrs`;
    }
    return 'N/A';
  };

  const extractExperience = (breakdown) => {
    if (breakdown.Experience) {
      const exp = breakdown.Experience;
      return `${exp.actual || 0} yrs`;
    }
    return 'N/A';
  };

  const getStatusColor = (status) => {
    const colors = {
      PENDING: { bg: "#FFF3E0", color: "#E65100", label: "Pending" },
      REVIEWING: { bg: "#E3F2FD", color: "#1565C0", label: "Under Review" },
      QUALIFIED: { bg: "#E8F5E9", color: "#2E7D32", label: "Qualified" },
      SHORTLISTED: { bg: "#E8F5E9", color: "#2E7D32", label: "Shortlisted" },
      INTERVIEW_SCHEDULED: { bg: "#F3E5F5", color: "#7B1FA2", label: "Interview Scheduled" },
      HIRED: { bg: "#E8F5E9", color: "#1B5E20", label: "Hired" },
      NOT_SELECTED: { bg: "#FFEBEE", color: "#C62828", label: "Not Selected" },
      REJECTED: { bg: "#FFEBEE", color: "#C62828", label: "Rejected" },
      WITHDRAWN: { bg: "#F3E5F5", color: "#6A1B9A", label: "Withdrawn" }
    };
    return colors[status] || colors["PENDING"];
  };

  const getScoreColor = (score) => {
    if (!score) return "#6c757d";
    if (score >= 80) return "#2e7d32";
    if (score >= 60) return "#e65100";
    return "#c62828";
  };

  const getScoreBg = (score) => {
    if (!score) return "#f5f5f5";
    if (score >= 80) return "#e8f5e9";
    if (score >= 60) return "#fff3e0";
    return "#ffebee";
  };

  const formatDate = (dateString) => {
    if (!dateString) return "N/A";
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const checkDocumentsComplete = (docs, jobRequiredDocs) => {
    if (!docs) return false;
    
    let allComplete = docs.pds === true;
    
    if (jobRequiredDocs?.transcriptRecords) {
      allComplete = allComplete && docs.transcript === true;
    }
    
    if (jobRequiredDocs?.performanceRating) {
      allComplete = allComplete && docs.performanceRating === true;
    }
    
    return allComplete;
  };

  // ===== MASS SELECT FUNCTIONS =====
  const toggleRowSelection = (candidateId) => {
    setSelectedRows(prev => {
      if (prev.includes(candidateId)) {
        return prev.filter(id => id !== candidateId);
      } else {
        return [...prev, candidateId];
      }
    });
  };

  const toggleSelectAll = () => {
    const visibleIds = filteredCandidates.map(c => c.id);
    const allSelected = visibleIds.every(id => selectedRows.includes(id));
    if (allSelected) {
      setSelectedRows([]);
    } else {
      setSelectedRows(visibleIds);
    }
  };

 const bulkUpdateStatus = async (newStatus) => {
  if (selectedRows.length === 0) {
    alert('Please select at least one candidate.');
    return;
  }

  setBulkUpdating(true);

  try {
    // Get current applications data
    const { data: appsData, error: appsError } = await supabase
      .from('applications')
      .select('id, applicant_id, job_id, status')
      .in('id', selectedRows);

    if (appsError) throw appsError;

    // Get job details for notifications
    const { data: jobData, error: jobError } = await supabase
      .from('job_postings')
      .select('position_title')
      .eq('id', appsData[0]?.job_id)
      .single();

    if (jobError) throw jobError;

    const updatePromises = appsData.map(async (app) => {
      const oldStatus = app.status || 'PENDING';

      // 1. Update application status
      const { error } = await supabase
        .from('applications')
        .update({
          status: newStatus,
          updated_at: new Date().toISOString()
        })
        .eq('id', app.id);

      if (error) throw error;

      // 2. Send notification
      try {
        await notifyStatusChange(
          app.applicant_id,
          jobData.position_title,
          oldStatus,
          newStatus
        );
        console.log(`📨 Notification sent to applicant ${app.applicant_id}`);
      } catch (notifyError) {
        console.error('Error sending notification:', notifyError);
      }

      // 3. Handle interview record - ONLY if status is INTERVIEW_SCHEDULED
      if (newStatus === 'INTERVIEW_SCHEDULED') {
        // CHECK if interview already exists for this application
        const { data: existingInterview, error: checkError } = await supabase
          .from('interviews')
          .select('id, scheduled_date, needs_scheduling, status')
          .eq('application_id', app.id)
          .maybeSingle();

        if (checkError) {
          console.error('❌ Error checking existing interview:', checkError);
        }

        console.log(`🔍 Application ${app.id}: Existing interview:`, existingInterview);

        // ONLY create if NO interview exists
        if (!existingInterview) {
          console.log(`✅ Creating NEW interview for application ${app.id}`);
          
          const { data: userData } = await supabase.auth.getUser();
          const userId = userData.user?.id || null;

          const { data: insertData, error: insertError } = await supabase
            .from('interviews')
            .insert({
              application_id: app.id,
              applicant_id: app.applicant_id,
              job_id: app.job_id,
              scheduled_date: null,
              duration_minutes: null,
              location: null,
              description: null,
              status: 'SCHEDULED',
              needs_scheduling: true,
              scheduled_by: userId,
              scheduled_at: new Date().toISOString(),
            })
            .select();

          if (insertError) {
            console.error('❌ Error inserting interview:', insertError);
          } else {
            console.log('✅ Interview inserted:', insertData);
            
            // ✅ UPDATE THE APPLICATION WITH interview_id
            if (insertData && insertData[0]) {
              const { error: updateAppError } = await supabase
                .from('applications')
                .update({ 
                  interview_id: insertData[0].id,
                  updated_at: new Date().toISOString()
                })
                .eq('id', app.id);
                
              if (updateAppError) {
                console.error('❌ Error updating application with interview_id:', updateAppError);
              } else {
                console.log(`✅ Application ${app.id} updated with interview_id: ${insertData[0].id}`);
              }
            }
          }
        } else {
          // Interview already exists - don't create duplicate
          console.log(`⚠️ Interview ALREADY EXISTS for application ${app.id}, SKIPPING creation`);
          
          // If interview exists but needs_scheduling is false, update it
          if (existingInterview.needs_scheduling === false && existingInterview.scheduled_date) {
            console.log(`🔄 Interview already scheduled, keeping existing schedule`);
          } else if (existingInterview.needs_scheduling === true) {
            console.log(`🔄 Interview already needs scheduling, keeping as is`);
          }
        }
      }
    });

    await Promise.all(updatePromises);

    // Show success notification instead of alert
setBulkUpdateSuccessMessage(` Successfully updated ${selectedRows.length} candidate(s) to ${newStatus}`);
setTimeout(() => setBulkUpdateSuccessMessage(null), 5000);

setSelectedRows([]);
setMassSelectMode(false);
loadJobAndCandidates();

} catch (error) {
console.error('Error updating candidates:', error);
alert('Error updating candidates: ' + error.message);
} finally {
setBulkUpdating(false);
}
};

  const toggleCompare = (candidate) => {
    if (compareMode) {
      const index = selectedCompareCandidates.findIndex(c => c.id === candidate.id);
      if (index === -1) {
        if (selectedCompareCandidates.length >= 2) {
          alert('You can only compare up to 2 candidates at a time.');
          return;
        }
        setSelectedCompareCandidates([...selectedCompareCandidates, candidate]);
      } else {
        setSelectedCompareCandidates(selectedCompareCandidates.filter(c => c.id !== candidate.id));
      }
    } else {
      setCompareMode(true);
      setSelectedCompareCandidates([candidate]);
    }
  };

  const clearCompareSelection = () => {
    setCompareMode(false);
    setSelectedCompareCandidates([]);
    setShowCompareModal(false);
  };

  const openCompareModal = () => {
    if (selectedCompareCandidates.length === 2) {
      setShowCompareModal(true);
    } else {
      alert('Please select 2 candidates to compare.');
    }
  };

  const getComparisonSummary = (candidateA, candidateB) => {
    const aScore = candidateA.ai_match_score || 0;
    const bScore = candidateB.ai_match_score || 0;

    const higher = aScore >= bScore ? candidateA : candidateB;
    const lower = aScore >= bScore ? candidateB : candidateA;

    const reasons = [];

    // Education comparison
    const aEdu = cleanEducationText(candidateA.education);
    const bEdu = cleanEducationText(candidateB.education);

    if (aEdu !== bEdu && aEdu !== 'N/A' && bEdu !== 'N/A') {
      const eduLevels = [
        'None',
        'Elementary',
        'High School',
        '2-Year College',
        "Bachelor's",
        "Master's",
        'PhD/Doctorate'
      ];

      const aLevel = eduLevels.indexOf(aEdu);
      const bLevel = eduLevels.indexOf(bEdu);

      if (aLevel > bLevel) {
        reasons.push(`including higher educational attainment (${aEdu} degree compared to ${bEdu} degree)`);
      } else if (bLevel > aLevel) {
        reasons.push(`including higher educational attainment (${bEdu} degree compared to ${aEdu} degree)`);
      }
    }

    // Eligibility comparison
    const aEligibility = candidateA.eligibility || 'None';
    const bEligibility = candidateB.eligibility || 'None';

    if (aEligibility !== bEligibility) {
      const higherEligibility = aScore >= bScore ? aEligibility : bEligibility;

      if (higherEligibility !== 'None' && higherEligibility !== 'N/A') {
        reasons.push(`${higherEligibility} career service eligibility`);
      }
    }

    // Training
    const aTrain = parseInt(candidateA.training) || 0;
    const bTrain = parseInt(candidateB.training) || 0;

    if (aTrain !== bTrain) {
      const higherTrain = Math.max(aTrain, bTrain);
      const lowerTrain = Math.min(aTrain, bTrain);

      reasons.push(`more training hours (${higherTrain} compared to ${lowerTrain})`);
    }

    // Experience
    const aExp = parseInt(candidateA.experience) || 0;
    const bExp = parseInt(candidateB.experience) || 0;

    if (aExp !== bExp) {
      const higherExp = Math.max(aExp, bExp);
      const lowerExp = Math.min(aExp, bExp);

      reasons.push(`${higherExp} years of relevant work experience compared to ${lower.applicant_name}'s ${lowerExp} years`);
    }

    // No differences found
    if (reasons.length === 0) {
      return "Both candidates have comparable qualifications based on the assessment.";
    }

    // Convert array into natural sentence
    const reasonText = reasons.length > 1
      ? reasons.slice(0, -1).join(", ") + ", and " + reasons[reasons.length - 1]
      : reasons[0];

    return `${higher.applicant_name} ranks higher due to stronger qualifications, ${reasonText}.`;
  };

  const exportShortlistPDF = () => {
  const isFullyQualified = (candidate) => {
  return candidate.status === 'SHORTLISTED' || candidate.status === 'QUALIFIED';
};

    const shortlisted = candidates.filter(c => 
      (c.status === 'SHORTLISTED' || c.status === 'QUALIFIED') &&
      isFullyQualified(c)
    );

    if (shortlisted.length === 0) {
      alert('No shortlisted candidates to export.');
      return;
    }

    const doc = new jsPDF('p', 'mm', 'a4');
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 20;
    const lineWidth = pageWidth - (margin * 2);

    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('CITY GOVERNMENT OF ILIGAN', pageWidth / 2, 20, { align: 'center' });
    
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.text('HUMAN RESOURCE MANAGEMENT OFFICE', pageWidth / 2, 28, { align: 'center' });

    doc.setDrawColor(100);
    doc.line(margin, 32, pageWidth - margin, 32);

    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('SHORTLIST OF QUALIFIED CANDIDATES', pageWidth / 2, 42, { align: 'center' });

    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    doc.text(`For the Position of: ${job?.position_title || 'N/A'}`, pageWidth / 2, 50, { align: 'center' });

    doc.setFontSize(9);
    doc.setFont('helvetica', 'italic');
    doc.text('All candidates below satisfy the encoded qualification criteria for the position.', pageWidth / 2, 58, { align: 'center' });

    const today = new Date().toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Date Generated: ${today}`, margin, 68);
    doc.text(`Item No.: ${job?.item_no || 'N/A'}`, margin, 75);
    doc.text(`Total Applicants: ${candidates.length}  |  Shortlisted: ${shortlisted.length}`, margin, 82);

    const tableData = shortlisted.map((c, index) => {
      let experienceDisplay = 'N/A';
      let status = 'FIT';
      
      if (c.experience && c.experience !== 'N/A') {
        const match = c.experience.match(/([\d.]+)\/([\d.]+)/);
        if (match) {
          const actual = parseFloat(match[1]);
          const required = parseFloat(match[2]);
          if (required === 0) {
            experienceDisplay = 'Not Required';
          } else {
            experienceDisplay = `${actual}/${required} yrs`;
            if (actual > required) {
              status = 'HIGHLY FIT';
            }
          }
        } else {
          experienceDisplay = c.experience;
        }
      }

      const educationDisplay = cleanEducationText(c.education) || 'N/A';
      if (educationDisplay.includes('Master') || educationDisplay.includes('PhD')) {
        status = 'HIGHLY FIT';
      }

      return [
        index + 1,
        c.applicant_name,
        educationDisplay,
        c.eligibility !== 'None' && c.eligibility !== 'N/A' 
          ? c.eligibility 
          : 'N/A',
        experienceDisplay,
        status
      ];
    });

    autoTable(doc, {
      startY: 88,
      head: [['#', 'Name', 'Education', 'Eligibility', 'Experience', 'Status']],
      body: tableData,
      theme: 'grid',
      styles: {
        fontSize: 8,
        cellPadding: 2,
        overflow: 'linebreak',
        valign: 'middle',
      },
      headStyles: {
        fillColor: [79, 70, 229],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 8,
        halign: 'center',
      },
      alternateRowStyles: {
        fillColor: [245, 247, 250],
      },
      columnStyles: {
        0: { cellWidth: 8, halign: 'center' },
        1: { cellWidth: 38, halign: 'left' },
        2: { cellWidth: 28, halign: 'left' },
        3: { cellWidth: 30, halign: 'left' },
        4: { cellWidth: 30, halign: 'left' },
        5: { cellWidth: 28, halign: 'center' },
      },
      margin: { left: margin, right: margin },
      tableWidth: lineWidth,
    });

    let finalY = doc.lastAutoTable.finalY + 8;

    doc.setDrawColor(100);
    doc.line(margin, finalY, pageWidth - margin, finalY);
    finalY += 8;

    const highlyFit = shortlisted.filter(c => {
      let exceeds = false;
      
      if (c.experience && c.experience !== 'N/A') {
        const match = c.experience.match(/([\d.]+)\/([\d.]+)/);
        if (match) {
          const actual = parseFloat(match[1]);
          const required = parseFloat(match[2]);
          if (required > 0 && actual > required) exceeds = true;
        }
      }
      const edu = cleanEducationText(c.education);
      if (edu.includes('Master') || edu.includes('PhD')) exceeds = true;
      
      return exceeds;
    }).length;

    const fit = shortlisted.length - highlyFit;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('SUMMARY', margin, finalY);
    finalY += 6;

    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(`Total Qualified: ${shortlisted.length}`, margin, finalY);
    finalY += 5;
    doc.text(`Highly Fit: ${highlyFit}`, margin + 5, finalY);
    finalY += 5;
    doc.text(`Fit: ${fit}`, margin + 5, finalY);
    finalY += 8;

    if (finalY > 250) {
      doc.addPage();
      finalY = 20;
    }

    doc.setDrawColor(100);
    doc.line(margin, finalY, pageWidth - margin, finalY);

    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('Prepared by:', margin, finalY + 12);
    doc.text('Approved by:', pageWidth - margin - 35, finalY + 12);

    doc.setFont('helvetica', 'normal');
    doc.text('_________________________', margin, finalY + 22);
    doc.text('_________________________', pageWidth - margin - 35, finalY + 22);

    doc.setFontSize(8);
    doc.text('HRMO Designate', margin, finalY + 30);
    doc.text('HRMPSB Chairperson', pageWidth - margin - 35, finalY + 30);

    doc.setFontSize(9);
    doc.setFont('helvetica', 'italic');
    doc.text('This is a certified true copy of the shortlist.', pageWidth / 2, finalY + 42, { align: 'center' });

    doc.setFontSize(40);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(200, 200, 200);
    doc.text('FOR HRMPSB REVIEW', pageWidth / 2, 160, { align: 'center', angle: 45 });
    doc.setTextColor(0);

    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(7);
      doc.setTextColor(150);
      doc.text(`Page ${i} of ${pageCount}`, pageWidth / 2, 285, { align: 'center' });
      doc.text('FOR HRMPSB REVIEW USE', margin, 285);
      doc.text(`Generated: ${today}`, pageWidth - margin, 285, { align: 'right' });
      doc.setTextColor(0);
    }

    doc.save(`Shortlist_${job?.position_title?.replace(/\s+/g, '_') || 'Candidates'}_${new Date().toISOString().split('T')[0]}.pdf`);
  };

  const updateCandidateStatus = async (applicationId, newStatus) => {
  setUpdatingStatus(true);
  
  try {
    const oldStatus = selectedApplication?.status || 'PENDING';
    
    const { data: appData, error: appError } = await supabase
      .from('applications')
      .select('applicant_id, job_id')
      .eq('id', applicationId)
      .single();
    
    if (appError) throw appError;
    
    const { data: jobData, error: jobError } = await supabase
      .from('job_postings')
      .select('position_title')
      .eq('id', appData.job_id)
      .single();
    
    if (jobError) throw jobError;
    
    const { error } = await supabase
      .from('applications')
      .update({ 
        status: newStatus,
        updated_at: new Date().toISOString()
      })
      .eq('id', applicationId);
    
    if (error) throw error;
    
    if (newStatus === 'INTERVIEW_SCHEDULED') {
      const { data: existingInterview, error: checkError } = await supabase
        .from('interviews')
        .select('id')
        .eq('application_id', applicationId)
        .maybeSingle();
      
      if (!existingInterview) {
        const { data: userData } = await supabase.auth.getUser();
        const userId = userData.user?.id || null;
        
        const { error: insertError } = await supabase
          .from('interviews')
          .insert({
            application_id: applicationId,
            applicant_id: appData.applicant_id,
            job_id: appData.job_id,
            scheduled_date: null,
            duration_minutes: null,
            location: null,
            description: null,
            status: 'SCHEDULED',
            needs_scheduling: true,
            scheduled_by: userId,
            scheduled_at: new Date().toISOString(),
          });
        
        if (insertError) {
          console.error('Error creating interview record:', insertError);
        } else {
          console.log('✅ Interview record created for TBD scheduling');
        }
      } else {
        console.log('ℹ️ Interview record already exists for this application');
      }
    }
    
    console.log('📨 Sending notification to applicant...');
    
    const result = await notifyStatusChange(
      appData.applicant_id,
      jobData.position_title,
      oldStatus,
      newStatus
    );
    
    console.log('📨 Notification result:', result);
    
    //  CRITICAL: Close all modals FIRST
    setShowStatusConfirm(false);
    setShowDetailsModal(false);
    setSelectedApplication(null);
    setPendingStatus(null);
    
    // Turn off loading state
    setUpdatingStatus(false);
    
    // Show success message
    setStatusSuccessMessage(` Status updated to "${newStatus}" successfully!`);
    
    // Auto-hide after 5 seconds
    setTimeout(() => {
      setStatusSuccessMessage('');
    }, 5000);
    
    // Refresh data
    loadJobAndCandidates();
    
  } catch (error) {
    console.error('Error updating status:', error);
    
    // Close modals on error too
    setShowStatusConfirm(false);
    setShowDetailsModal(false);
    setSelectedApplication(null);
    setPendingStatus(null);
    
    // Turn off loading state
    setUpdatingStatus(false);
    
    // Show error message
    setStatusSuccessMessage(`❌ Error updating status: ${error.message}`);
    
    setTimeout(() => {
      setStatusSuccessMessage('');
    }, 5000);
  }
};
  const filteredCandidates = candidates
    .filter((c) => {
      const matchesSearch = c.applicant_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           c.applicant_email.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStatus = filterStatus === "All" || c.status === filterStatus;
      
      let matchesDocuments = true;
      if (filterDocuments === "Complete") {
        matchesDocuments = checkDocumentsComplete(c.docs_submitted, job?.required_docs);
      } else if (filterDocuments === "Incomplete") {
        matchesDocuments = !checkDocumentsComplete(c.docs_submitted, job?.required_docs);
      }
      
      return matchesSearch && matchesStatus && matchesDocuments;
    })
    .sort((a, b) => {
      let aVal, bVal;
      if (sortBy === "ai_score") {
        aVal = a.ai_match_score || 0;
        bVal = b.ai_match_score || 0;
        return sortOrder === "desc" ? bVal - aVal : aVal - bVal;
      } else if (sortBy === "rank") {
        aVal = a.rank || 999;
        bVal = b.rank || 999;
        return sortOrder === "asc" ? aVal - bVal : bVal - aVal;
      } else if (sortBy === "status") {
        aVal = a.status || '';
        bVal = b.status || '';
        return sortOrder === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      } else {
        aVal = new Date(a.applied_date);
        bVal = new Date(b.applied_date);
        return sortOrder === "desc" ? bVal - aVal : aVal - bVal;
      }
    });

  const stats = {
    total: candidates.length,
    qualified: candidates.filter(c => c.status === "QUALIFIED" || c.status === "REVIEWING" || c.status === "SHORTLISTED").length,
    interviewed: candidates.filter(c => c.status === "INTERVIEW_SCHEDULED" || c.status === "FOR_INTERVIEW").length,
    pending: candidates.filter(c => c.status === "PENDING").length,
  };

  return (
    <>
      <Navbar userRole="hr" />

      <div className="candidate-container">
        <div className="page-header"  >
          <div className="back-link" onClick={() => navigate(returnPath)} 
           style={{ 
    display: 'flex', 
    alignItems: 'center', 
    gap: '1px',
    cursor: 'pointer'
  }}
  >
           <ReverseTabArrowIcon/> <span> Back </span>
          </div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: '1px' }}>
          <img src={communityLogo} alt="Community"
           style={{ width: 28, height: 28, verticalAlign: 'middle', marginRight: '10px',
          filter: 'brightness(0) saturate(100%) invert(15%) sepia(60%) saturate(800%) hue-rotate(180deg) brightness(95%) contrast(90%)' }} />
          Candidates for {job?.position_title || 'Loading...'}</h1>
          <p>Showing {candidates.length} applicant(s) for this position</p>
        </div>

        {loading ? (
          <div className="loading-state" style={{ 
    display: 'flex', 
    flexDirection: 'column', 
    alignItems: 'center', 
    justifyContent: 'center',
    padding: '10px 0',
    minHeight: '250px'
  }}>
    <p style={{ marginBottom: '16px', color: '#6c757d', fontSize: '14px' }}>Loading candidates...</p>
    <Loader />
  </div>
        ) : (
          <>
            <div className="stats-cards">
              <div className="stat-card">
                <span className="stat-number">{stats.total}</span>
                <span className="stat-label">Total Applicants</span>
              </div>
              <div className="stat-card">
                <span className="stat-number">{stats.qualified}</span>
                <span className="stat-label">Qualified</span>
              </div>
              <div className="stat-card">
                <span className="stat-number">{stats.interviewed}</span>
                <span className="stat-label">For Interview</span>
              </div>
              <div className="stat-card">
                <span className="stat-number">{stats.pending}</span>
                <span className="stat-label">Pending</span>
              </div>
            </div>

            <div className="controls">
              <input
                type="text"
                className="search-input"
                placeholder="Search by name or email..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              <select
                className="filter-select"
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
              >
                <option value="All">All Status</option>
                <option value="PENDING">Pending</option>
                <option value="REVIEWING">Under Review</option>
                <option value="SHORTLISTED">Shortlisted</option>
                <option value="QUALIFIED">Qualified</option>
                <option value="INTERVIEW_SCHEDULED">Interview Scheduled</option>
                <option value="HIRED">Hired</option>
                <option value="NOT_SELECTED">Not Selected</option>
                <option value="REJECTED">Rejected</option>
              </select>
              <select
                className="filter-select"
                value={filterDocuments}
                onChange={(e) => setFilterDocuments(e.target.value)}
              >
                <option value="All">All Documents</option>
                <option value="Complete">Complete Only</option>
                <option value="Incomplete">Incomplete Only</option>
              </select>
              <span className="sort-label">Sort:</span>
              <button
                className={`sort-btn ${sortBy === "rank" ? "active" : ""}`}
                onClick={() => {
                  if (sortBy === "rank") {
                    setSortOrder(sortOrder === "asc" ? "desc" : "asc");
                  } else {
                    setSortBy("rank");
                    setSortOrder("asc");
                  }
                }}
              >
                Rank {sortBy === "rank" && (sortOrder === "asc" ? "↑" : "↓")}
              </button>
              <button
                className={`sort-btn ${sortBy === "ai_score" ? "active" : ""}`}
                onClick={() => {
                  if (sortBy === "ai_score") {
                    setSortOrder(sortOrder === "desc" ? "asc" : "desc");
                  } else {
                    setSortBy("ai_score");
                    setSortOrder("desc");
                  }
                }}
              >
                AI Score {sortBy === "ai_score" && (sortOrder === "desc" ? "↓" : "↑")}
              </button>
         
            </div>

            {/* Mass Select Toggle & Actions */}
            <div className="mass-select-btn" style={{
              background: massSelectMode ? '#f0f4ff' : 'transparent',
              borderRadius: '8px',
              border: massSelectMode ? '1px solid #4f46e5' : '1px solid transparent',
              transition: 'all 0.3s ease'
            }}>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <button
                  onClick={() => {
                    setMassSelectMode(!massSelectMode);
                    if (massSelectMode) setSelectedRows([]);
                  }}
                  style={{
                    padding: '6px 16px',
                    background: massSelectMode ? '#dc2626' : '#4f46e5',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontWeight: '500',
                    fontSize: '13px',
                     display: 'inline-flex',
                  }}
                >
              {massSelectMode ? (
    '✕ Cancel'
  ) : (
    <>
      <CheckboxMassIcon size={16}  />
      Mass Select
    </>
  )}

                </button>

                {massSelectMode && (
                  <>
                    <button
                      onClick={toggleSelectAll}
                      style={{
                        padding: '6px 12px',
                        background: '#e9ecef',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontSize: '13px'
                      }}
                    >
                      {filteredCandidates.every(c => selectedRows.includes(c.id)) ? 'Deselect All' : 'Select All'}
                    </button>

                    <span style={{ fontSize: '13px', color: '#6c757d' }}>
                      {selectedRows.length} selected
                    </span>
                  </>
                )}
              </div>

              {massSelectMode && selectedRows.length > 0 && (
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <select
                    value={bulkStatus}
                    onChange={(e) => setBulkStatus(e.target.value)}
                    style={{
                      padding: '6px 12px',
                      border: '1px solid #dee2e6',
                      borderRadius: '6px',
                      fontSize: '13px',
                      background: 'white'
                    }}
                  >
                    <option value="PENDING">Pending</option>
                    <option value="REVIEWING">Under Review</option>
                    <option value="SHORTLISTED">Shortlisted</option>
                    <option value="QUALIFIED">Qualified</option>
                    <option value="INTERVIEW_SCHEDULED">Interview Scheduled</option>
                    <option value="HIRED">Hired</option>
                    <option value="NOT_SELECTED">Not Selected</option>
                    <option value="REJECTED">Rejected</option>
                  </select>
                 <button
  onClick={() => {
    if (selectedRows.length === 0) {
      alert('Please select at least one candidate.');
      return;
    }
    setPendingBulkStatus(bulkStatus);
    setShowBulkConfirmModal(true);
  }}
  disabled={bulkUpdating}
  style={{
    padding: '6px 16px',
    background: '#0d9488',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: bulkUpdating ? 'not-allowed' : 'pointer',
    fontWeight: '500',
    fontSize: '13px',
    opacity: bulkUpdating ? 0.6 : 1,
     transition: 'background 0.2s ease'
  }}
   onMouseEnter={(e) => {
    if (!bulkUpdating) {
      e.currentTarget.style.background = '#0f766e';
    }
  }}
  onMouseLeave={(e) => {
    if (!bulkUpdating) {
      e.currentTarget.style.background = '#0d9488';
    }
  }}
>
  {bulkUpdating ? 'Updating...' : `Apply to ${selectedRows.length}`}
</button>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '8px' }}>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                {compareMode && (
                  <>
                    <span style={{ fontSize: '13px', color: '#6c757d' }}>
                      Selected {selectedCompareCandidates.length}/2 candidates
                    </span>
                    <button className="clear-compare-button"
                      onClick={clearCompareSelection}>
                      ✕ Clear
                    </button>
                    {selectedCompareCandidates.length === 2 && (
                     <button className="compare-blue-button"
                        onClick={openCompareModal}>
                          <img 
    src={compareplumpLogo} 
    alt="compare" 
    style={{ 
      width: 16, height: 16,
      filter: 'brightness(0) saturate(100%) invert(100%) brightness(200%)'
    }} />  Compare
                    </button>
                    )}
                  </>
                )}
              </div>
          
            </div>

            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    {massSelectMode && (
                      <th style={{ width: '40px' }}>
                        <input
                          type="checkbox"
                          checked={filteredCandidates.length > 0 && filteredCandidates.every(c => selectedRows.includes(c.id))}
                          onChange={toggleSelectAll}
                        />
                      </th>
                    )}
                    <th>#</th>
                    <th>Name</th>
                    <th>Documents</th>
                    <th>Score</th>
                    <th className="xai-column">XAI</th>
                    <th className="status-column">Status</th>
                    <th className="action-column">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCandidates.length === 0 ? (
                    <tr>
                      <td colSpan={massSelectMode ? 8 : 7}>
                        <div className="empty-state">No candidates found</div>
                      </td>
                    </tr>
                  ) : (
                    filteredCandidates.map((candidate) => {
                      const statusStyle = getStatusColor(candidate.status);
                      const docsComplete = checkDocumentsComplete(candidate.docs_submitted, job?.required_docs);
                      const isSelected = selectedCompareCandidates.some(c => c.id === candidate.id);

                      return (
                        <tr key={candidate.id}>
                          {massSelectMode && (
                            <td>
                              <input
                                type="checkbox"
                                checked={selectedRows.includes(candidate.id)}
                                onChange={() => toggleRowSelection(candidate.id)}
                              />
                            </td>
                          )}
                          <td className="rank-cell">#{candidate.rank}</td>
                          <td>
                            <div className="applicant-cell">
                              <div className="avatar">{candidate.applicant_name.charAt(0)}</div>
                              <div className="applicant-info">
                                <span className="applicant-name">{candidate.applicant_name}</span>
                                <span className="applicant-email">{candidate.applicant_email}</span>
                              </div>
                            </div>
                          </td>
                          <td>
                                     <span 
  className={`doc-status ${docsComplete ? 'doc-complete' : 'doc-incomplete'}`}
  style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
>
  {docsComplete ? (
    <>
      <CheckSquareIcon size={16}  /> Complete
    </>
  ) : (
    <>
      <span style={{ color: '#ef4444', fontSize: '16px' }}>✕</span> Incomplete
    </>
  )}
</span>
                          </td>
                          <td>
                            <span
                              className="score-badge"
                              style={{
                                background: getScoreBg(candidate.ai_match_score),
                                color: getScoreColor(candidate.ai_match_score),
                              }}
                            >
                              {candidate.ai_match_score}%
                            </span>
                          </td>
                          <td>
                              <button 
                              className="explain-btn"
                              onClick={() => {
                                setSelectedForExplain(candidate);
                                setShowExplainModal(true);
                              }}
                               style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px'
    }}
                            >
                             <MagnifyingGlassPlumpIcon size={15} style={{ color: '#1a56db' }} /> XAI
                            </button>
                          </td>
                          <td>
                            <span
                              className="status-badge"
                              style={{
                                backgroundColor: statusStyle.bg,
                                color: statusStyle.color,
                              }}
                            >
                              {statusStyle.label}
                            </span>
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                              <button
                                className="view-btn"
                                onClick={() => {
                                  setSelectedApplication(candidate);
                                  setShowDetailsModal(true);
                                }}
                                style={{ padding: '4px 8px', fontSize: '11px' }}
                              >
                                View
                              </button>
                             <button
  onClick={() => toggleCompare(candidate)}
  style={{
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    padding: '4px 8px',
    fontSize: '11px',
    background: isSelected ? '#4f46e5' : '#e9ecef',
    color: isSelected ? 'white' : '#4a5568',
    border: isSelected ? 'none' : '1px solid #dee2e6',
    borderRadius: '4px',
    cursor: 'pointer'
  }}
>
  {isSelected ? (
    <>
      <span>✓</span> Selected
    </>
  ) : (
    <>
      <img 
        src={compareplumpLogo} 
        alt="compare" 
        style={{ 
          width: 16, 
          height: 16,
          filter: isSelected ? 'none' : 'brightness(0) saturate(100%) invert(15%) sepia(60%) saturate(800%) hue-rotate(180deg) brightness(95%) contrast(90%)'
        }} 
      />
      Compare
    </>
  )}
</button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* View Interview Schedule Button - Placed at the bottom of the table */}
            <div className = "view-interview-schedule-div" >
              <button className="view-interview-schedule-button"
                onClick={() => {
                  navigate(`/hr/jobs/${jobId}/interviews`, { 
                    state: { from: location.pathname } 
                  });
                }}
                onMouseEnter={(e) => {
                  e.target.style.background = '#4338ca';
                  e.target.style.transform = 'translateY(-2px)';
                  e.target.style.boxShadow = '0 4px 12px rgba(79, 70, 229, 0.4)';
                }}
                onMouseLeave={(e) => {
                  e.target.style.background = '#4f46e5';
                  e.target.style.transform = 'translateY(0)';
                  e.target.style.boxShadow = '0 2px 8px rgba(79, 70, 229, 0.3)';
                }}
              >
                <img src={calendarminimalLogo} alt="Community"
           style={{ width: 18, height: 18,
           filter: 'brightness(0) saturate(100%) invert(100%) brightness(90%)' }} /> View Interview Schedule
              </button>
              <button  className="export-shortlist-btn"
                onClick={exportShortlistPDF} >
                <PdfIcon size={14}/> Export Shortlist (PDF)
              </button>
            </div>
          </>
        )}
      </div>

      {/* XAI Explanation Modal */}
      {showExplainModal && selectedForExplain && (
        <div className="modal-overlay" onClick={() => setShowExplainModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
             <h3 style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
  <MagnifyingGlassPlumpIcon size={26} style={{ color: '#1a56db' }} />
  XAI Explanation
</h3>
              <button className="close-modal" onClick={() => setShowExplainModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <div style={{ marginBottom: 16 }}>
                <strong style={{ fontSize: 18, color: '#1a1f36' }}>
                  {selectedForExplain.applicant_name}
                </strong>
                <span style={{ marginLeft: 12, fontSize: 14, color: '#6c757d' }}>
                  Rank: #{selectedForExplain.rank}
                </span>
              </div>

              <div className="explanation-container">
                <div className="explanation-score" style={{ color: getScoreColor(selectedForExplain.ai_match_score) }}>
                  Suitability Score: {selectedForExplain.ai_match_score}%
                </div>

                <div className="requirements-met">
                  Requirements Met: {selectedForExplain.explanation.requirements_met || '0/0'}
                </div>

                <div className="explanation-section-title">Contributing Factors:</div>
                {selectedForExplain.explanation.contributing_factors.map((factor, idx) => (
                  <div key={idx} className="explanation-factor">✓ {factor}</div>
                ))}

                {selectedForExplain.explanation.score_reduced.length > 0 && (
                  <>
                    <div className="explanation-section-title">Score reduced because:</div>
                    {selectedForExplain.explanation.score_reduced.map((factor, idx) => (
                      <div key={idx} className="explanation-factor-reduced">• {factor}</div>
                    ))}
                  </>
                )}
{console.log('XAI data:', selectedForExplain.explanation)}
{console.log('buildSummary output:', buildSummary(selectedForExplain))}
            <div className="explanation-summary">
  {buildSummary(selectedForExplain)}
</div>
              </div>

              <div className="modal-actions">
                <button className="close-btn" onClick={() => setShowExplainModal(false)}>Close</button>
              </div>
            </div>
          </div>
        </div>
      )}

{/* Bulk Update Success Notification */} {bulkUpdateSuccessMessage && 
( <div style={{ position: 'fixed', bottom: '20px', right: '20px', padding: '12px 20px', background: '#0D9488',
 color: 'white', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', zIndex: 9999, display: 'flex',
  alignItems: 'center', gap: '10px', animation: 'slideIn 0.3s ease' }}> <CircularCheckSuccessIcon size={19}
   style={{ color: 'white' }} /> <span>{bulkUpdateSuccessMessage}</span> </div> )}

      {/* Application Details Modal */}
      {showDetailsModal && selectedApplication && (
        <div className="modal-overlay" onClick={() => setShowDetailsModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Candidate Details</h3>
              <button className="close-modal" onClick={() => setShowDetailsModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="detail-section">
                <h4>Profile</h4>
                <div className="detail-grid">
                  <div><span className="detail-label">Name</span><span className="detail-value">{selectedApplication.applicant_name}</span></div>
                  <div><span className="detail-label">Email</span><span className="detail-value">{selectedApplication.applicant_email}</span></div>
                  <div><span className="detail-label">Rank</span><span className="detail-value">#{selectedApplication.rank}</span></div>
                  <div><span className="detail-label">AI Match Score</span><span className="detail-value">{selectedApplication.ai_match_score}%</span></div>
                </div>
              </div>

              <div className="detail-section">
  <h4> Submitted Documents</h4>
  <ul className="docs-list" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
    <li style={{ 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'space-between',
      padding: '8px 0',
      borderBottom: '1px solid #f0f0f0'
    }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {selectedApplication.docs_submitted?.pds ? (
          <DocumentCheckIcon size={26} color="#16e19d" />
        ) : (
          <span style={{ color: '#ef4444', fontSize: '14px' }}>✕</span>
        )}
        Personal Data Sheet (PDS)
      </span>
      {selectedApplication.docs_submitted?.pds && (
       <JobCandidateButton 
  onClick={() => viewDocument(
    selectedApplication.job_id,
    selectedApplication.applicant_id,
    'pds',
    'PDS'
  )}
/>
      )}
    </li>
    
    {job?.required_docs?.transcriptRecords && (
      <li style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between',
        padding: '8px 0',
        borderBottom: '1px solid #f0f0f0'
      }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {selectedApplication.docs_submitted?.transcript ? (
            <DocumentCheckIcon size={26} color="#16e19d" />
          ) : (
            <span style={{ color: '#ef4444', fontSize: '20px', marginLeft: '5px' }}>✕</span>
          )}
          Transcript of Records
        </span>
        {selectedApplication.docs_submitted?.transcript && (
        <JobCandidateButton 
  onClick={() => viewDocument(
    selectedApplication.job_id,
    selectedApplication.applicant_id,
    'transcript',
    'Transcript'
  )}
/>

        )}
      </li>
    )}
    
    {job?.required_docs?.performanceRating && (
      <li style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between',
        padding: '8px 0',
        borderBottom: '1px solid #f0f0f0'
      }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {selectedApplication.docs_submitted?.performanceRating ? (
            <DocumentCheckIcon size={26} color="#16e19d" />
          ) : (
            <span style={{ color: '#ef4444', fontSize: '20px',  marginLeft: '5px' }}>✕</span>
          )}
          Performance Rating
        </span>
        {selectedApplication.docs_submitted?.performanceRating && (
       <JobCandidateButton 
  onClick={() => viewDocument(
    selectedApplication.job_id,
    selectedApplication.applicant_id,
    'performanceRating',
    'Performance Rating'
  )}
/>
        )}
      </li>
    )}
  </ul>
</div>

              <div className="detail-section">
                <h4>Qualifications</h4>
                <div className="detail-grid">
                  <div><span className="detail-label">Education</span><span className="detail-value">{selectedApplication.education}</span></div>
                  <div><span className="detail-label">Eligibility</span><span className="detail-value">{selectedApplication.eligibility || 'None'}</span></div>
                  <div><span className="detail-label">Training</span><span className="detail-value">{selectedApplication.training}</span></div>
                  <div><span className="detail-label">Experience</span><span className="detail-value">{selectedApplication.experience}</span></div>
                </div>
              </div>

              <div className="detail-section">
                <h4>Application Details</h4>
                <div className="detail-grid">
                  <div><span className="detail-label">Status</span>
                    <div className="status-update-section">
                      <select 
                        value={selectedApplication.status}
                        onChange={(e) => {
                          const newStatus = e.target.value;
                          setSelectedApplication({...selectedApplication, status: newStatus});
                        }}
                      >
                        <option value="PENDING">Pending</option>
                        <option value="REVIEWING">Under Review</option>
                        <option value="SHORTLISTED">Shortlisted</option>
                        <option value="INTERVIEW_SCHEDULED">For Interview</option>
                        <option value="HIRED">Hired</option>
                        <option value="NOT_SELECTED">Not Selected</option>
                        <option value="REJECTED">Rejected</option>
                      </select>
                      <button 
  onClick={() => {
    setPendingStatus(selectedApplication.status);
    setShowStatusConfirm(true);
  }}
  disabled={updatingStatus}
  style={{
    padding: '8px 16px',
    background: updatingStatus ? '#4338ca' : '#4F46E5',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: updatingStatus ? 'not-allowed' : 'pointer',
    fontWeight: '500',
    transition: 'background 0.2s ease',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    opacity: updatingStatus ? 0.7 : 1
  }}
  onMouseEnter={(e) => {
    if (!updatingStatus) e.currentTarget.style.background = '#4338ca';
  }}
  onMouseLeave={(e) => {
    if (!updatingStatus) e.currentTarget.style.background = '#4F46E5';
  }}
>
  {updatingStatus ? (
    <>
      <span className="spinner" />
      Updating...
    </>
  ) : (
    'Update'
  )}
</button>
                    </div>
                  </div>
                  <div><span className="detail-label">Applied Date</span><span className="detail-value">{formatDate(selectedApplication.applied_date)}</span></div>
                </div>
              </div>

              <div className="modal-actions">
                <button className="close-btn" onClick={() => setShowDetailsModal(false)}>Close</button>
                {selectedApplication.status !== 'INTERVIEW_SCHEDULED' && (
                  <button 
      className="schedule-btn" 
      onClick={() => {
        setPendingStatus('INTERVIEW_SCHEDULED');
        setShowStatusConfirm(true);
      }}
      disabled={updatingStatus}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        padding: '8px 16px',
        background: updatingStatus ? '#4338ca' : '#4F46E5',
        color: 'white',
        border: 'none',
        borderRadius: '6px',
        cursor: updatingStatus ? 'not-allowed' : 'pointer',
        fontWeight: '500',
        transition: 'background 0.2s ease',
        opacity: updatingStatus ? 0.7 : 1
      }}
      onMouseEnter={(e) => {
        if (!updatingStatus) e.currentTarget.style.background = '#4338ca';
      }}
      onMouseLeave={(e) => {
        if (!updatingStatus) e.currentTarget.style.background = '#4F46E5';
      }}
    >
      <img 
        src={calendarminimalLogo} 
        alt="Calendar" 
        style={{ 
          width: 18, 
          height: 18, 
          filter: 'brightness(0) saturate(100%) invert(100%) brightness(100%)' 
        }} 
      />
      Schedule Interview
    </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* COMPARE CANDIDATES MODAL */}
      {showCompareModal && selectedCompareCandidates.length === 2 && (
        <div className="modal-overlay" onClick={() => setShowCompareModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '900px' }}>
            <div className="modal-header">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
  <img 
    src={compareplumpLogo} 
    alt="compare" 
    style={{ 
      width: 26, 
      height: 26,
      filter: 'brightness(0) saturate(100%) invert(15%) sepia(60%) saturate(800%) hue-rotate(180deg) brightness(95%) contrast(90%)'
    }} 
  />
  Compare Candidates
</h3>
              <button className="close-modal" onClick={() => setShowCompareModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ padding: '12px', textAlign: 'left', background: '#f8f9fa', borderBottom: '2px solid #e9ecef' }}>Criteria</th>
                      <th style={{ padding: '12px', textAlign: 'center', background: '#f8f9fa', borderBottom: '2px solid #e9ecef', minWidth: '200px' }}>
                        <div style={{ fontWeight: 'bold', color: '#1a1f36' }}>{selectedCompareCandidates[0].applicant_name}</div>
                        <div style={{ fontSize: '14px', color: '#4f46e5' }}>Rank #{selectedCompareCandidates[0].rank} • {selectedCompareCandidates[0].ai_match_score}%</div>
                      </th>
                      <th style={{ padding: '12px', textAlign: 'center', background: '#f8f9fa', borderBottom: '2px solid #e9ecef', minWidth: '200px' }}>
                        <div style={{ fontWeight: 'bold', color: '#1a1f36' }}>{selectedCompareCandidates[1].applicant_name}</div>
                        <div style={{ fontSize: '14px', color: '#6c757d' }}>Rank #{selectedCompareCandidates[1].rank} • {selectedCompareCandidates[1].ai_match_score}%</div>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style={{ padding: '10px 12px', fontWeight: '600', borderBottom: '1px solid #f0f0f0' }}>Score</td>
                      <td style={{ padding: '10px 12px', textAlign: 'center', borderBottom: '1px solid #f0f0f0' }}>
                        <span style={{ 
                          background: getScoreBg(selectedCompareCandidates[0].ai_match_score),
                          color: getScoreColor(selectedCompareCandidates[0].ai_match_score),
                          padding: '4px 12px',
                          borderRadius: '20px',
                          fontWeight: '600'
                        }}>
                          {selectedCompareCandidates[0].ai_match_score}%
                        </span>
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'center', borderBottom: '1px solid #f0f0f0' }}>
                        <span style={{ 
                          background: getScoreBg(selectedCompareCandidates[1].ai_match_score),
                          color: getScoreColor(selectedCompareCandidates[1].ai_match_score),
                          padding: '4px 12px',
                          borderRadius: '20px',
                          fontWeight: '600'
                        }}>
                          {selectedCompareCandidates[1].ai_match_score}%
                        </span>
                      </td>
                    </tr>

                    <tr>
                      <td style={{ padding: '10px 12px', fontWeight: '600', borderBottom: '1px solid #f0f0f0' }}>Requirements Met</td>
                      <td style={{ padding: '10px 12px', textAlign: 'center', borderBottom: '1px solid #f0f0f0' }}>
                        {selectedCompareCandidates[0].explanation?.requirements_met || '0/0'}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'center', borderBottom: '1px solid #f0f0f0' }}>
                        {selectedCompareCandidates[1].explanation?.requirements_met || '0/0'}
                      </td>
                    </tr>

                    <tr>
                      <td style={{ padding: '10px 12px', fontWeight: '600', borderBottom: '1px solid #f0f0f0' }}>Education</td>
                      <td style={{ padding: '10px 12px', textAlign: 'center', borderBottom: '1px solid #f0f0f0' }}>
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
    {cleanEducationText(selectedCompareCandidates[0].education)}
    {(() => {
      const edu = selectedCompareCandidates[0].education || '';
      const eduLevels = ['None', 'Elementary', 'High School', '2-Year College', "Bachelor's", "Master's", "PhD/Doctorate"];
      const actualLevel = eduLevels.indexOf(cleanEducationText(edu));
      const requiredLevel = jobRequirements.education || 0;
      if (requiredLevel === 0) return <span style={{ fontSize: '12px', color: '#6c757d' }}> (Not Required)</span>;
      return actualLevel >= requiredLevel ? 
        <CheckInterviewIconDashboard size={18} style={{ color: '#10b981' }} /> : 
        <span style={{ color: '#dc2626', fontSize: '16px', marginLeft: '3px' }}>✕</span>;
    })()}
  </span>
</td>

                     <td style={{ padding: '10px 12px', textAlign: 'center', borderBottom: '1px solid #f0f0f0' }}>
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
    {cleanEducationText(selectedCompareCandidates[1].education)}
    {(() => {
      const edu = selectedCompareCandidates[1].education || '';
      const eduLevels = ['None', 'Elementary', 'High School', '2-Year College', "Bachelor's", "Master's", "PhD/Doctorate"];
      const actualLevel = eduLevels.indexOf(cleanEducationText(edu));
      const requiredLevel = jobRequirements.education || 0;
      if (requiredLevel === 0) return <span style={{ fontSize: '12px', color: '#6c757d' }}> (Not Required)</span>;
      return actualLevel >= requiredLevel ? 
        <CheckInterviewIconDashboard size={18} style={{ color: '#10b981' }} /> : 
        <span style={{ color: '#dc2626', fontSize: '16px', marginLeft: '3px' }}>✕</span>;
    })()}
  </span>
</td>
                    </tr>

                    <tr>
                      <td style={{ padding: '10px 12px', fontWeight: '600', borderBottom: '1px solid #f0f0f0' }}>Eligibility</td>
                    <td style={{ padding: '10px 12px', textAlign: 'center', borderBottom: '1px solid #f0f0f0' }}>
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
    {selectedCompareCandidates[0].eligibility !== 'None' ? `CS ${selectedCompareCandidates[0].eligibility}` : 'None Required'}
    {(() => {
      const actual = selectedCompareCandidates[0].eligibility || 'None';
      const required = jobRequirements.eligibility;
      if (!required || required === '' || required === 'None' || required === 'none' || required === 'null' || required === 'None Required') {
        return <span style={{ fontSize: '12px', color: '#6c757d' }}> (Not Required)</span>;
      }
      return actual.toLowerCase() === required.toLowerCase() ? 
        <CheckInterviewIconDashboard size={18} style={{ color: '#10b981' }} /> : 
        <span style={{ color: '#dc2626', fontSize: '16px', marginLeft: '3px' }}>✕</span>;
    })()}
  </span>
</td>

<td style={{ padding: '10px 12px', textAlign: 'center', borderBottom: '1px solid #f0f0f0' }}>
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
    {selectedCompareCandidates[1].eligibility !== 'None' ? `CS ${selectedCompareCandidates[1].eligibility}` : 'None Required'}
    {(() => {
      const actual = selectedCompareCandidates[1].eligibility || 'None';
      const required = jobRequirements.eligibility;
      if (!required || required === '' || required === 'None' || required === 'none' || required === 'null' || required === 'None Required') {
        return <span style={{ fontSize: '12px', color: '#6c757d' }}> (Not Required)</span>;
      }
      return actual.toLowerCase() === required.toLowerCase() ? 
        <CheckInterviewIconDashboard size={18} style={{ color: '#10b981' }} /> : 
        <span style={{ color: '#dc2626', fontSize: '16px', marginLeft: '3px' }}>✕</span>;
    })()}
  </span>
</td>
                    </tr>

                    <tr>
                      <td style={{ padding: '10px 12px', fontWeight: '600', borderBottom: '1px solid #f0f0f0' }}>Training</td>
                    <td style={{ padding: '10px 12px', textAlign: 'center', borderBottom: '1px solid #f0f0f0' }}>
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
    {selectedCompareCandidates[0].training || 'N/A'}
    {(() => {
      const training = selectedCompareCandidates[0].training || '';
      const match = training.match(/(\d+)\s*\/\s*(\d+)/);
      if (match) {
        const actual = parseInt(match[1]);
        const required = parseInt(match[2]);
        if (required === 0) return <span style={{ fontSize: '12px', color: '#6c757d' }}> (Not Required)</span>;
        return actual >= required ? 
          <CheckInterviewIconDashboard size={18} style={{ color: '#10b981' }} /> : 
          <span style={{ color: '#dc2626', fontSize: '16px', marginLeft: '3px' }}>✕</span>;
      }
      return <span style={{ fontSize: '12px', color: '#6c757d' }}> (Not Required)</span>;
    })()}
  </span>
</td>

<td style={{ padding: '10px 12px', textAlign: 'center', borderBottom: '1px solid #f0f0f0' }}>
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
    {selectedCompareCandidates[1].training || 'N/A'}
    {(() => {
      const training = selectedCompareCandidates[1].training || '';
      const match = training.match(/(\d+)\s*\/\s*(\d+)/);
      if (match) {
        const actual = parseInt(match[1]);
        const required = parseInt(match[2]);
        if (required === 0) return <span style={{ fontSize: '12px', color: '#6c757d' }}> (Not Required)</span>;
        return actual >= required ? 
          <CheckInterviewIconDashboard size={18} style={{ color: '#10b981' }} /> : 
          <span style={{ color: '#dc2626', fontSize: '16px', marginLeft: '3px' }}>✕</span>;
      }
      return <span style={{ fontSize: '12px', color: '#6c757d' }}> (Not Required)</span>;
    })()}
  </span>
</td>
                    </tr>

                    <tr>
                      <td style={{ padding: '10px 12px', fontWeight: '600', borderBottom: '1px solid #f0f0f0' }}>Experience</td>
                     <td style={{ padding: '10px 12px', textAlign: 'center', borderBottom: '1px solid #f0f0f0' }}>
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
    {selectedCompareCandidates[0].experience || 'N/A'}
    {(() => {
      const exp = selectedCompareCandidates[0].experience || '';
      const match = exp.match(/(\d+)/);
      if (match) {
        const actual = parseInt(match[1]);
        const required = jobRequirements.workExperience || 0;
        if (required === 0) return <span style={{ fontSize: '12px', color: '#6c757d' }}> (Not Required)</span>;
        return actual >= required ? 
          <CheckInterviewIconDashboard size={18} style={{ color: '#10b981' }} /> : 
          <span style={{ color: '#dc2626', fontSize: '16px', marginLeft: '3px' }}>✕</span>;
      }
      return <span style={{ fontSize: '12px', color: '#6c757d' }}> (Not Required)</span>;
    })()}
  </span>
</td>

<td style={{ padding: '10px 12px', textAlign: 'center', borderBottom: '1px solid #f0f0f0' }}>
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
    {selectedCompareCandidates[1].experience || 'N/A'}
    {(() => {
      const exp = selectedCompareCandidates[1].experience || '';
      const match = exp.match(/(\d+)/);
      if (match) {
        const actual = parseInt(match[1]);
        const required = jobRequirements.workExperience || 0;
        if (required === 0) return <span style={{ fontSize: '12px', color: '#6c757d' }}> (Not Required)</span>;
        return actual >= required ? 
          <CheckInterviewIconDashboard size={18} style={{ color: '#10b981' }} /> : 
          <span style={{ color: '#dc2626', fontSize: '16px', marginLeft: '3px' }}>✕</span>;
      }
      return <span style={{ fontSize: '12px', color: '#6c757d' }}> (Not Required)</span>;
    })()}
  </span>
</td>
                    </tr>

                    <tr>
                      <td style={{ padding: '10px 12px', fontWeight: '600', borderBottom: '1px solid #f0f0f0' }}>Status</td>
                      <td style={{ padding: '10px 12px', textAlign: 'center', borderBottom: '1px solid #f0f0f0' }}>
                        <span className="status-badge" style={{
                          backgroundColor: getStatusColor(selectedCompareCandidates[0].status).bg,
                          color: getStatusColor(selectedCompareCandidates[0].status).color,
                          padding: '4px 12px',
                          borderRadius: '20px',
                          fontSize: '12px'
                        }}>
                          {getStatusColor(selectedCompareCandidates[0].status).label}
                        </span>
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'center', borderBottom: '1px solid #f0f0f0' }}>
                        <span className="status-badge" style={{
                          backgroundColor: getStatusColor(selectedCompareCandidates[1].status).bg,
                          color: getStatusColor(selectedCompareCandidates[1].status).color,
                          padding: '4px 12px',
                          borderRadius: '20px',
                          fontSize: '12px'
                        }}>
                          {getStatusColor(selectedCompareCandidates[1].status).label}
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div style={{ marginTop: '20px', padding: '16px', background: '#f8f9fa', borderRadius: '10px' }}>
               <h4 style={{ 
  margin: '0 0 8px 0', 
  fontSize: '14px', 
  color: '#1a1f36',
  display: 'flex',
  alignItems: 'center',
  gap: '6px'
}}>
  <JusticePlumpIcon size={18} />
  Quick Comparison Summary:
</h4>
                <div style={{ fontSize: '14px', color: '#4a5568', whiteSpace: 'pre-line' }}>
                  {getComparisonSummary(selectedCompareCandidates[0], selectedCompareCandidates[1])}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '12px', marginTop: '20px' }}>
                <button className="close-btn" onClick={() => setShowCompareModal(false)} style={{ flex: 1, padding: '10px', background: 'white', border: '1px solid #dee2e6', borderRadius: '8px', cursor: 'pointer' }}>
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}


      
{/* Bulk Update Confirmation Modal */}
{showBulkConfirmModal && (
  <div className="modal-overlay" onClick={() => setShowBulkConfirmModal(false)}>
    <div className="confirm-card" onClick={(e) => e.stopPropagation()}>
      {/* Simple Header with Icon */}
      <div className="confirm-card-header">
        <span className="confirm-icon" style = {{marginBottom: '4px'}}><CheckMarkSquareInterviewIcon size={38}  color="#43ae4d"/></span>
        <h3>Confirm Update</h3>
      </div>
      
      {/* Message */}
      <div className="confirm-card-body">
        <p>
          Are you sure you want to update <strong>{selectedRows.length}</strong> candidate(s) to:
        </p>
        <p style={{ 
          fontWeight: '600', 
          fontSize: '18px', 
          color: '#1a1f36',
          marginTop: '8px',
          textTransform: 'capitalize'
        }}>
          {pendingBulkStatus}
        </p>
      </div>
      
      {/* Actions */}
      <div className="confirm-card-footer" style={{ margin: '0 -24px -24px -24px', padding: '16px 24px', borderRadius: '0 0 12px 12px' }}>
        <button 
          className="btn-cancel"
          onClick={() => setShowBulkConfirmModal(false)}
        >
          Cancel
        </button>
        <button 
          className="btn-confirm"
          onClick={() => {
            setShowBulkConfirmModal(false);
            bulkUpdateStatus(pendingBulkStatus);
          }}
          style={{ background: '#0d9488', transition: 'background 0.2s ease' }}
           onMouseEnter={(e) => e.currentTarget.style.background = '#0f766e'}
  onMouseLeave={(e) => e.currentTarget.style.background = '#0d9488'}
        >
          Confirm
        </button>
      </div>
    </div>
  </div>
)}


{/* Status Update Success Notification */}
{statusSuccessMessage && (
  <div style={{
    position: 'fixed',
    bottom: '20px',
    right: '20px',
    padding: '12px 20px',
    background: statusSuccessMessage.includes('Error') ? '#dc2626' : '#0D9488',
    color: 'white',
    borderRadius: '8px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
    zIndex: 9999,
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    animation: 'slideIn 0.3s ease'
  }}>
    {statusSuccessMessage.includes('Error') ? (
      <span style={{ fontSize: '18px' }}>❌</span>
    ) : (
      <CircularCheckSuccessIcon size={18} style={{ color: 'white' }} />
    )}
    <span>{statusSuccessMessage}</span>
  </div>
)}

{/* Status Update Confirmation Modal */}
{showStatusConfirm && (
  <div className="modal-overlay" onClick={() => {
    if (!updatingStatus) setShowStatusConfirm(false);
  }}>
    <div className="confirm-card" onClick={(e) => e.stopPropagation()}>
      <div className="confirm-card-header">
        <span className="confirm-icon" style={{ fontSize: '28px' }}>    <CheckMarkSquareInterviewIcon size={38} color="#43ae4d" /></span>
        <h3>Confirm Status Update</h3>
      </div>
      <div className="confirm-card-body">
        <p>Are you sure you want to change the status to?</p>
        <p style={{ 
          fontWeight: '600', 
          fontSize: '16px', 
          color: '#1a1f36',
          marginTop: '8px'
        }}>
          {pendingStatus}
        </p>
        <p style={{ color: '#6c757d', fontSize: '14px', marginTop: '8px' }}>
          This will notify the applicant of the status change.
        </p>
      </div>
      <div className="confirm-card-footer" style={{ margin: '0 -24px -24px -24px', padding: '16px 24px', borderRadius: '0 0 12px 12px' }}>
        <button 
          className="btn-cancel" 
          onClick={() => setShowStatusConfirm(false)}
          disabled={updatingStatus}
          style={{
            padding: '8px 24px',
            background: '#D3F0F9',
            color: '#1a3a5c',
            border: 'none',
            borderRadius: '6px',
            cursor: updatingStatus ? 'not-allowed' : 'pointer',
            fontWeight: '500',
            transition: 'background 0.2s ease',
            opacity: updatingStatus ? 0.5 : 1
          }}
          onMouseEnter={(e) => {
            if (!updatingStatus) e.currentTarget.style.background = '#b8e4f0';
          }}
          onMouseLeave={(e) => {
            if (!updatingStatus) e.currentTarget.style.background = '#D3F0F9';
          }}
        >
          Cancel
        </button>
        <button 
          className="btn-confirm"
          onClick={() => {
            setShowStatusConfirm(false);
            updateCandidateStatus(selectedApplication.id, pendingStatus);
          }}
          disabled={updatingStatus}
          style={{
            padding: '8px 24px',
            background: updatingStatus ? '#0f766e' : '#0d9488',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: updatingStatus ? 'not-allowed' : 'pointer',
            fontWeight: '500',
            transition: 'all 0.2s ease',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            opacity: updatingStatus ? 0.7 : 1
          }}
          onMouseEnter={(e) => {
            if (!updatingStatus) e.currentTarget.style.background = '#0f766e';
          }}
          onMouseLeave={(e) => {
            if (!updatingStatus) e.currentTarget.style.background = '#0d9488';
          }}
        >
          {updatingStatus ? (
            <>
              <span className="spinner" />
              Updating...
            </>
          ) : (
            'Confirm'
          )}
        </button>
      </div>
    </div>
  </div>
)}


    </>
  );
}